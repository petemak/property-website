(ns kigali.gallery-seed-test
  (:require [clojure.java.io :as io]
            [clojure.test :refer [deftest is testing use-fixtures]]
            [kigali.test-helpers :as h :refer [request]]))

(use-fixtures :each h/with-system)

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
    (testing "lead image is the front-yard photo, listed first"
      (is (= "/api/media/gallery/front-yard.jpg" (:url lead)))
      (is (= (:id lead) (:id (first images)))))
    (testing "dining hand-wash corner is filed under Living"
      (is (= "Living" (:category (first (filter #(re-find #"washcorner" (:url %)) images))))))
    (testing "real dimensions (not the 2400x1600 placeholder)"
      (is (every? #(and (pos? (:width %)) (pos? (:height %))) images))
      (is (not-every? #(= [2400 1600] [(:width %) (:height %)]) images)))
    (testing "original and thumbnail are actually served by /api/media"
      (is (= 200 (:status (request :get (:url lead)))))
      (is (= 200 (:status (request :get (:thumbnailUrl lead))))))))

(deftest exact-location-image-is-never-served
  (testing "approx map is served"
    (is (= 200 (:status (request :get "/api/media/map/approx.png")))))
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
    (is (not (re-find #"(?i)dedicated desk" (:description body))))
    (is (re-find #"(?i)dining table" (:description body)))
    (is (not (re-find #"(?i)for six|seats six" (:description body))))
    (is (re-find #"(?i)for four" (:description body)))
    (is (not (re-find #"(?i)dedicated desk" (:label desk))))
    (is (not (re-find #"(?i)ergonomic" (:answer faq))))
    (is (re-find #"(?i)fibre|fiber" (:answer faq)))))
