(ns kigali.gallery-seed-test
  (:require [clojure.java.io :as io]
            [clojure.test :refer [deftest is testing use-fixtures]]
            [kigali.features.gallery :as gallery]
            [kigali.images :as images]
            [kigali.test-helpers :as h :refer [request]]))

(use-fixtures :each h/with-system)

(defn- media-file [rel]
  (io/file (get-in h/*ctx* [:config :media :dir]) rel))

(deftest gallery-seeded-from-real-photos
  (let [{:keys [status body]} (request :get "/api/gallery")
        images (:images body)
        lead (first (filter #(= (:id %) (:leadImageId body)) images))]
    (is (= 200 status))
    (testing "all 25 enumerated files, no Workspace category"
      (is (= 25 (count images)))
      (is (not (contains? (set (map :category images)) "Workspace")))
      (is (= {"Exterior & grounds" 4 "Living" 5 "Kitchen" 2 "Bedroom 1" 4
              "Bedroom 2" 3 "Bathrooms" 5 "The car" 2}
             (frequencies (map :category images)))))
    (testing "seed image URLs are CDN-relative /media/... (not proxied /api/media/...)"
      (is (every? #(re-matches #"/media/gallery/.+" (:url %)) images))
      (is (every? #(re-matches #"/media/gallery/.+" (:thumbnailUrl %)) images))
      (is (= "/media/gallery/front-yard.jpg" (:url lead)))
      (is (= "/media/gallery/front-yard_thumb.jpg" (:thumbnailUrl lead)))
      (is (= (:id lead) (:id (first images)))))
    (testing "dining hand-wash corner is filed under Living"
      (is (= "Living" (:category (first (filter #(re-find #"washcorner" (:url %)) images))))))
    (testing "real dimensions, downscaled to the web budget (<= 2000px long edge)"
      (is (every? #(and (pos? (:width %)) (pos? (:height %))) images))
      (is (every? #(<= (max (:width %) (:height %)) images/full-max-edge) images)))
    (testing "re-encoded on ingest: stored files are within the size budget"
      (doseq [img images]
        (let [full (media-file (str "gallery/" (last (re-find #"/media/gallery/(.+)$" (:url img)))))
              thumb (media-file (str "gallery/" (last (re-find #"/media/gallery/(.+)$" (:thumbnailUrl img)))))]
          (is (.exists full))
          (is (.exists thumb))
          (is (<= (.length full) images/full-max-bytes) (str (:url img) " over full budget"))
          (is (<= (.length thumb) images/thumb-max-bytes) (str (:thumbnailUrl img) " over thumb budget")))))))

(deftest url-prefix-depends-on-origin
  (testing "seed rows -> CDN-relative /media/... ; uploaded rows -> proxied /api/media/..."
    (is (= {:url "/media/gallery/front-yard.jpg"
            :thumbnailUrl "/media/gallery/front-yard_thumb.jpg"}
           (select-keys (gallery/image->json {:origin "seed" :filename "front-yard.jpg"
                                              :thumb_filename "front-yard_thumb.jpg"})
                        [:url :thumbnailUrl])))
    (is (= {:url "/api/media/gallery/img_ab12cd34.jpg"
            :thumbnailUrl "/api/media/gallery/img_ab12cd34_thumb.jpg"}
           (select-keys (gallery/image->json {:origin "upload" :filename "img_ab12cd34.jpg"
                                              :thumb_filename "img_ab12cd34_thumb.jpg"})
                        [:url :thumbnailUrl]))))
  (testing "GET /gallery: every seed row is on the /media/ path"
    (let [{:keys [body]} (request :get "/api/gallery")]
      (is (every? #(re-find #"^/media/" (:url %)) (:images body))))))

(deftest exact-location-image-is-never-served
  (testing "exact-location image is not reachable under /api/media by any name"
    (doseq [p ["/api/media/map/exact-location.png"
               "/api/media/map/exact.png"
               "/api/media/location-map/exact-location.png"]]
      (is (= 404 (:status (request :get p))) (str p " must not resolve"))))
  (testing "the file was not copied into the media dir"
    (let [media-dir (get-in h/*ctx* [:config :media :dir])]
      (is (empty? (->> (file-seq (io/file media-dir))
                       (filter #(.isFile %))
                       (map #(.getName %))
                       (filter #(re-find #"(?i)exact" %))))))))

(deftest property-copy-no-longer-overpromises
  (let [{:keys [body]} (request :get "/api/property")
        desk (first (filter #(= "desk" (:key %)) (:amenities body)))
        faq (first (filter #(re-find #"workspace" (:question %)) (:faq body)))]
    (is (= "/media/map/approx.jpg" (get-in body [:location :staticMapUrl])))
    (is (not (re-find #"(?i)dedicated desk" (:description body))))
    (is (re-find #"(?i)dining table" (:description body)))
    (is (not (re-find #"(?i)for six|seats six" (:description body))))
    (is (re-find #"(?i)seats four" (:description body)))
    (is (not (re-find #"(?i)dedicated desk" (:label desk))))
    (is (not (re-find #"(?i)ergonomic" (:answer faq))))
    (is (re-find #"(?i)fibre|fiber" (:answer faq)))))
