(ns kigali.availability-test
  (:require [clojure.test :refer [deftest is]]
            [kigali.features.availability :as availability]
            [kigali.util :as util]))

(deftest expand-blocks-clips-to-window
  (let [rows [{:start_date "2026-09-10" :end_date "2026-09-13"}
              {:start_date "2026-08-01" :end_date "2026-09-03"}]
        from (util/parse-date "2026-09-01")
        to (util/parse-date "2026-09-30")]
    (is (= ["2026-09-01" "2026-09-02" "2026-09-10" "2026-09-11" "2026-09-12"]
           (availability/expand-blocks rows from to)))))

(deftest expand-blocks-end-is-exclusive
  (let [rows [{:start_date "2026-09-05" :end_date "2026-09-08"}]
        from (util/parse-date "2026-09-01")
        to (util/parse-date "2026-09-30")]
    (is (= ["2026-09-05" "2026-09-06" "2026-09-07"]
           (availability/expand-blocks rows from to)))))
