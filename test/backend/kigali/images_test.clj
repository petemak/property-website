(ns kigali.images-test
  (:require [clojure.java.io :as io]
            [clojure.test :refer [deftest is testing]]
            [kigali.images :as images]))

(deftest thumbnail-and-dimensions
  (let [dir (str (System/getProperty "java.io.tmpdir") "/kk-img-" (System/nanoTime))
        src (io/file dir "src.jpg")
        thumb (io/file dir "thumb.jpg")]
    (images/write-solid-placeholder! src 1200 800)
    (is (= {:width 1200 :height 800} (images/dimensions (images/read-image src))))
    (let [t (images/write-thumbnail! src thumb)]
      (is (.exists thumb))
      (testing "long edge is downscaled to the thumb budget"
        (is (<= (:width t) images/thumb-max-edge))
        (is (= 800 (:width t)))
        (is (= 533 (:height t))))
      (testing "thumb is within the byte budget"
        (is (<= (.length thumb) images/thumb-max-bytes))))))

(deftest web-image-is-downscaled-and-within-budget
  (let [dir (str (System/getProperty "java.io.tmpdir") "/kk-img-" (System/nanoTime))
        src (io/file dir "big.jpg")
        out (io/file dir "web.jpg")]
    (images/write-solid-placeholder! src 4000 3000)
    (let [r (images/write-web-image! src out)]
      (is (= 2000 (:width r)))
      (is (= 1500 (:height r)))
      (is (<= (:bytes r) images/full-max-bytes))
      (is (.exists out)))))

(deftest never-upscales
  (let [dir (str (System/getProperty "java.io.tmpdir") "/kk-img-" (System/nanoTime))
        src (io/file dir "small.jpg")
        out (io/file dir "web.jpg")]
    (images/write-solid-placeholder! src 900 600)
    (let [r (images/write-web-image! src out)]
      (is (= 900 (:width r)))
      (is (= 600 (:height r))))))
