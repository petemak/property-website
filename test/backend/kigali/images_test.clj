(ns kigali.images-test
  (:require [clojure.java.io :as io]
            [clojure.test :refer [deftest is]]
            [kigali.images :as images]))

(deftest thumbnail-and-dimensions
  (let [dir (str (System/getProperty "java.io.tmpdir") "/kk-img-" (System/nanoTime))
        src (io/file dir "src.jpg")
        thumb (io/file dir "thumb.jpg")]
    (images/write-solid-placeholder! src 1200 800)
    (is (= {:width 1200 :height 800} (images/dimensions (images/read-image src))))
    (let [t (images/write-thumbnail! src thumb)]
      (is (.exists thumb))
      (is (<= (:width t) images/thumb-max))
      (is (= 480 (:width t)))
      (is (= 320 (:height t))))))
