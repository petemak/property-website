(ns kigali.features.gallery
  "§2 public gallery, §21 gallery management. Uploads are proxied through the
   backend: the original is stored, a thumbnail and dimensions are generated
   here, never by a client-to-bucket call."
  (:require [clojure.java.io :as io]
            [kigali.db :as db]
            [kigali.images :as images]
            [kigali.middleware :as mw]
            [kigali.respond :as respond]
            [kigali.sanitize :as sanitize]
            [kigali.util :as util]))

(def categories
  #{"Exterior & grounds" "Living" "Kitchen" "Bedroom 1" "Bedroom 2"
    "Bathrooms" "Workspace" "The car"})

(def ^:private allowed-mime
  {"image/jpeg" "jpg" "image/jpg" "jpg" "image/png" "png" "image/webp" "webp"})

;; ---------------------------------------------------------------------------
;; Assembly (pure)

(defn image->json [row]
  {:id (:id row)
   :url (str "/api/media/gallery/" (:filename row))
   :thumbnailUrl (str "/api/media/gallery/" (:thumb_filename row))
   :alt (:alt row)
   :caption (:caption row)
   :category (:category row)
   :width (:width row)
   :height (:height row)
   :position (:position row)})

(defn gallery-response [rows]
  (let [sorted (sort-by :position rows)]
    {:leadImageId (some (fn [r] (when (util/->bool (:is_lead r)) (:id r))) sorted)
     :images (mapv image->json sorted)}))

;; ---------------------------------------------------------------------------
;; Queries

(defn all-images [dbc]
  (db/q dbc ["SELECT * FROM gallery_images ORDER BY position"]))

(defn- one-image [dbc id]
  (db/q1 dbc ["SELECT * FROM gallery_images WHERE id = ?" id]))

(defn- max-position [dbc]
  (or (:m (db/q1 dbc ["SELECT MAX(position) AS m FROM gallery_images"])) 0))

;; ---------------------------------------------------------------------------
;; Handlers

(defn- get-gallery [ctx _req]
  (respond/ok (gallery-response (all-images (:db ctx)))))

(defn- upload [ctx req]
  (let [db (:db ctx)
        media-dir (get-in ctx [:config :media :dir])
        max-bytes (get-in ctx [:config :media :max-upload-bytes])
        params (:multipart-params req)
        file (get params "file")
        alt (sanitize/plain (get params "alt"))
        caption (sanitize/plain (get params "caption"))
        category (get params "category")]
    (cond
      (not (map? file)) (respond/error :validationError "A file is required.")
      (or (nil? alt) (< (count alt) 1) (> (count alt) 250))
      (respond/error :validationError "alt is required and must be 1–250 characters.")
      (not (categories category)) (respond/error :validationError "category is not one of the allowed values.")
      (not (allowed-mime (:content-type file))) (respond/error :validationError "file must be jpg, png or webp.")
      (> (:size file 0) max-bytes) (respond/error :validationError "file exceeds the 12 MB limit.")
      :else
      (let [ext (allowed-mime (:content-type file))
            id (util/short-id "img")
            fname (str id "." ext)
            thumb (str id "_thumb.jpg")
            full-path (io/file media-dir "gallery" fname)
            thumb-path (io/file media-dir "gallery" thumb)]
        (io/make-parents full-path)
        (io/copy (:tempfile file) full-path)
        (let [{:keys [width height]} (images/dimensions (images/read-image full-path))]
          (images/write-thumbnail! full-path thumb-path)
          (db/exec! db ["INSERT INTO gallery_images
                         (id, filename, thumb_filename, alt, caption, category, width, height, position, is_lead, created_at)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?)"
                        id fname thumb alt caption category width height
                        (inc (max-position db)) 0 (util/now-iso)])
          (respond/created (image->json (one-image db id))))))))

(def patch-schema
  [:map
   [:alt {:optional true} [:string {:min 1 :max 250}]]
   [:caption {:optional true} [:maybe [:string {:max 500}]]]
   [:category {:optional true} (into [:enum] categories)]
   [:position {:optional true} [:int {:min 1}]]])

(defn- patch-image [ctx req]
  (let [db (:db ctx)
        id (get-in req [:path-params :id])
        row (one-image db id)
        body (mw/validate! patch-schema (:body-params req))]
    (if-not row
      (respond/error :notFound "No such image.")
      (let [alt (if (contains? body :alt) (sanitize/plain (:alt body)) (:alt row))
            caption (if (contains? body :caption) (sanitize/plain (:caption body)) (:caption row))
            category (or (:category body) (:category row))
            position (or (:position body) (:position row))]
        (db/exec! db ["UPDATE gallery_images SET alt = ?, caption = ?, category = ?, position = ? WHERE id = ?"
                      alt caption category position id])
        (respond/ok (image->json (one-image db id)))))))

(defn- delete-image [ctx req]
  (let [db (:db ctx)
        id (get-in req [:path-params :id])
        row (one-image db id)
        rows (all-images db)]
    (cond
      (nil? row) (respond/error :notFound "No such image.")
      (<= (count rows) 1) (respond/error :conflict "The gallery must keep at least one image.")
      (util/->bool (:is_lead row))
      (respond/error :conflict "Set another lead image before deleting this one.")
      :else
      (do (db/exec! db ["DELETE FROM gallery_images WHERE id = ?" id])
          (respond/no-content)))))

(def order-schema [:map [:orderedIds [:sequential :string]]])

(defn- put-order [ctx req]
  (let [db (:db ctx)
        {:keys [orderedIds]} (mw/validate! order-schema (:body-params req))
        known (set (map :id (all-images db)))]
    (when-not (= known (set orderedIds))
      (respond/throw-error! :validationError "orderedIds must list every image id exactly once."))
    (db/tx db (fn [t]
                (doseq [[i id] (map-indexed vector orderedIds)]
                  (db/exec! t ["UPDATE gallery_images SET position = ? WHERE id = ?" (inc i) id]))))
    (respond/ok (gallery-response (all-images db)))))

(def lead-schema [:map [:imageId :string]])

(defn- set-lead [ctx req]
  (let [db (:db ctx)
        {:keys [imageId]} (mw/validate! lead-schema (:body-params req))]
    (if-not (one-image db imageId)
      (respond/error :notFound "No such image.")
      (do (db/tx db (fn [t]
                      (db/exec! t ["UPDATE gallery_images SET is_lead = 0"])
                      (db/exec! t ["UPDATE gallery_images SET is_lead = 1 WHERE id = ?" imageId])))
          (respond/ok (gallery-response (all-images db)))))))

(defn routes [ctx]
  [["/gallery" {:get {:handler #(get-gallery ctx %)}}]
   ["/admin/gallery"
    {:get {:handler #(get-gallery ctx %) :middleware [[mw/wrap-admin ctx]]}
     :post {:handler #(upload ctx %) :middleware [[mw/wrap-admin ctx]]}}]
   ["/admin/gallery/order"
    {:put {:handler #(put-order ctx %) :middleware [[mw/wrap-admin ctx]]}}]
   ["/admin/gallery/lead"
    {:post {:handler #(set-lead ctx %) :middleware [[mw/wrap-admin ctx]]}}]
   ["/admin/gallery/:id"
    {:patch {:handler #(patch-image ctx %) :middleware [[mw/wrap-admin ctx]]}
     :delete {:handler #(delete-image ctx %) :middleware [[mw/wrap-admin ctx]]}}]])
