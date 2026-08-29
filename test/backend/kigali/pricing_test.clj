(ns kigali.pricing-test
  (:require [clojure.test :refer [deftest is testing]]
            [kigali.pricing :as pricing]))

(def pricing-cfg {:currency "USD" :nightlyRate 140 :cleaningFee 35 :minNights 3})
(def vehicle {:dailyRate 45})

(deftest quote-without-car
  (let [q (pricing/compute-quote pricing-cfg vehicle 4
                                 {:checkIn "2026-09-05" :checkOut "2026-09-12" :guests 2})]
    (is (= 7 (:nights q)))
    (is (= 0 (:carDays q)))
    (is (= 1015 (:estimatedTotal q)))
    (is (= 2 (count (:lineItems q))))
    (is (= [{:code "accommodation" :label "USD 140 x 7 nights" :amount 980}
            {:code "cleaningFee" :label "Cleaning fee" :amount 35}]
           (:lineItems q)))))

(deftest quote-with-car
  (let [q (pricing/compute-quote pricing-cfg vehicle 4
                                 {:checkIn "2026-09-05" :checkOut "2026-09-12" :guests 2
                                  :car {:requested true :pickUp "2026-09-06" :dropOff "2026-09-10"}})]
    (is (= 4 (:carDays q)))
    (is (= 1195 (:estimatedTotal q)))
    (is (= 1195 (:estimatedSubtotal q)))
    (is (= "Kia Sorento x 4 days (USD 45/day, paid on site)"
           (:label (last (:lineItems q)))))))

(deftest quote-rule-violations
  (testing "checkOut must be after checkIn"
    (is (thrown? clojure.lang.ExceptionInfo
                 (pricing/compute-quote pricing-cfg vehicle 4
                                        {:checkIn "2026-09-12" :checkOut "2026-09-05"}))))
  (testing "minimum nights"
    (is (thrown? clojure.lang.ExceptionInfo
                 (pricing/compute-quote pricing-cfg vehicle 4
                                        {:checkIn "2026-09-05" :checkOut "2026-09-07"}))))
  (testing "guests over max"
    (is (thrown? clojure.lang.ExceptionInfo
                 (pricing/compute-quote pricing-cfg vehicle 4
                                        {:checkIn "2026-09-05" :checkOut "2026-09-12" :guests 9}))))
  (testing "car window outside stay"
    (is (thrown? clojure.lang.ExceptionInfo
                 (pricing/compute-quote pricing-cfg vehicle 4
                                        {:checkIn "2026-09-05" :checkOut "2026-09-12"
                                         :car {:requested true :pickUp "2026-09-01" :dropOff "2026-09-10"}})))))

(deftest error-code-is-validation
  (try
    (pricing/compute-quote pricing-cfg vehicle 4 {:checkIn "2026-09-05" :checkOut "2026-09-06"})
    (is false "should have thrown")
    (catch clojure.lang.ExceptionInfo e
      (is (= :validationError (:code (ex-data e)))))))
