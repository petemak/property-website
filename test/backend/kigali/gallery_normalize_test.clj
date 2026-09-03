(ns kigali.gallery-normalize-test
  "Simulates a production in-place upgrade to the /media/ CDN scheme: an
   already-seeded DB whose gallery rows were written by the pre-/media/ seeder
   (source basename kept verbatim, camera-original bytes copied in, pre-resize
   dimensions on the row). kigali.seed/normalize-property-media! must bring such
   rows in line with a fresh seed, idempotently."
  (:require [clojure.java.io :as io]
            [clojure.test :refer [deftest is testing use-fixtures]]
            [kigali.db :as db]
            [kigali.images :as images]
            [kigali.seed :as seed]
            [kigali.test-helpers :as h :refer [request]]))

(use-fixtures :each h/with-system)

(def ^:private normalize! #'seed/normalize-property-media!)

(defn- media-dir [] (get-in h/*ctx* [:config :media :dir]))
(defn- photos-dir [] (get-in h/*ctx* [:config :seed :photos-dir]))
(defn- gfile [n] (io/file (media-dir) "gallery" n))
(defn- sorento1-src [] (io/file (photos-dir) "the-car/sorento1.jpeg"))

(defn- downgrade-sorento1-to-old-scheme!
  "Rewinds the sorento1 seed row to how the pre-/media/ seeder left it."
  [dbc]
  (.delete (gfile "sorento1.jpg"))
  (.delete (gfile "sorento1_thumb.jpg"))
  (io/copy (sorento1-src) (gfile "sorento1.jpeg"))
  (io/copy (sorento1-src) (gfile "sorento1_thumb.jpeg"))
  (db/exec! dbc ["UPDATE gallery_images
                  SET filename = 'sorento1.jpeg', thumb_filename = 'sorento1_thumb.jpeg',
                      width = 4032, height = 3024
                  WHERE filename = 'sorento1.jpg'"]))

(defn- expected-full-dims []
  (let [{:keys [width height]} (images/source-dimensions (sorento1-src))]
    (images/scaled-dimensions width height images/full-max-edge)))

(deftest normalizes-an-old-scheme-seed-row-in-place
  (let [dbc (:db h/*ctx*)]
    (downgrade-sorento1-to-old-scheme! dbc)
    (let [summary (normalize! dbc (media-dir) (photos-dir))
          row     (db/q1 dbc ["SELECT * FROM gallery_images WHERE filename = 'sorento1.jpg'"])
          {ew :width eh :height} (expected-full-dims)]
      (testing "row renamed to the canonical <stem>.jpg / <stem>_thumb.jpg scheme"
        (is (some? row))
        (is (= "sorento1.jpg" (:filename row)))
        (is (= "sorento1_thumb.jpg" (:thumb_filename row))))
      (testing "re-encoded files exist at the new names and are within budget"
        (is (.exists (gfile "sorento1.jpg")))
        (is (.exists (gfile "sorento1_thumb.jpg")))
        (is (<= (.length (gfile "sorento1.jpg")) images/full-max-bytes))
        (is (<= (.length (gfile "sorento1_thumb.jpg")) images/thumb-max-bytes)))
      (testing "stale old-extension files were deleted"
        (is (not (.exists (gfile "sorento1.jpeg"))))
        (is (not (.exists (gfile "sorento1_thumb.jpeg")))))
      (testing "width/height refreshed to the re-encoded, downscaled dimensions"
        (is (= ew (:width row)))
        (is (= eh (:height row)))
        (is (<= (max (:width row) (:height row)) images/full-max-edge)))
      (testing "summary counts exactly the one changed row"
        (is (= 1 (get-in summary [:gallery :renamed])))
        (is (= 1 (get-in summary [:gallery :re-encoded])))
        (is (= 24 (get-in summary [:gallery :untouched]))))
      (testing "GET /api/gallery now serves /media/gallery/sorento1.jpg (no .jpeg)"
        (let [urls (mapcat (juxt :url :thumbnailUrl)
                           (:images (:body (request :get "/api/gallery"))))]
          (is (some #{"/media/gallery/sorento1.jpg"} urls))
          (is (not-any? #(re-find #"\.jpeg$" %) urls)))))))

(deftest normalize-is-idempotent
  (let [dbc (:db h/*ctx*)]
    (downgrade-sorento1-to-old-scheme! dbc)
    (normalize! dbc (media-dir) (photos-dir))
    (let [again (normalize! dbc (media-dir) (photos-dir))]
      (testing "a second run re-encodes nothing and renames nothing"
        (is (= 0 (get-in again [:gallery :re-encoded])))
        (is (= 0 (get-in again [:gallery :renamed])))
        (is (= 25 (get-in again [:gallery :untouched])))
        (is (false? (:map-url-rewritten again)))))))

(deftest fresh-seed-needs-no-normalization
  (testing "the seeder already normalizes; an extra run is a no-op"
    (let [again (normalize! (:db h/*ctx*) (media-dir) (photos-dir))]
      (is (= 0 (get-in again [:gallery :re-encoded])))
      (is (= 0 (get-in again [:gallery :renamed])))
      (is (= 25 (get-in again [:gallery :untouched]))))))

(deftest normalized-old-db-matches-a-fresh-seed-listing
  (testing "fresh-seed sorento1 dims == normalized old-scheme sorento1 dims"
    (let [dbc  (:db h/*ctx*)
          fresh (db/q1 dbc ["SELECT filename, thumb_filename, width, height
                             FROM gallery_images WHERE filename = 'sorento1.jpg'"])
          fresh-len (.length (gfile "sorento1.jpg"))]
      (downgrade-sorento1-to-old-scheme! dbc)
      (normalize! dbc (media-dir) (photos-dir))
      (let [after (db/q1 dbc ["SELECT filename, thumb_filename, width, height
                              FROM gallery_images WHERE filename = 'sorento1.jpg'"])]
        (is (= fresh after))
        (is (= fresh-len (.length (gfile "sorento1.jpg"))))))))
