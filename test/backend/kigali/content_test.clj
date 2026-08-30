(ns kigali.content-test
  "Pure unit tests for the GET /property assembly — no HTTP, no DB."
  (:require [clojure.test :refer [deftest is testing]]
            [kigali.features.content :as content]))

(def ^:private settings
  {:hostDisplayName "Peter"
   :publicEmail "info@kigalikeys.rw"
   :publicPhone nil
   :guestResponseTimeText "Typically within 24–48 hours"})

(deftest contact-projection-maps-settings
  (let [c (content/contact-projection settings)]
    (is (= {:hostName "Peter"
            :email "info@kigalikeys.rw"
            :phone nil
            :responseTimeText "Typically within 24–48 hours"}
           c))
    (is (= #{:hostName :email :phone :responseTimeText} (set (keys c))))))

(deftest contact-phone-is-null-for-blank-or-placeholder
  (testing "nil / blank -> nil"
    (is (nil? (:phone (content/contact-projection settings))))
    (is (nil? (:phone (content/contact-projection (assoc settings :publicPhone "")))))
    (is (nil? (:phone (content/contact-projection (assoc settings :publicPhone "   "))))))
  (testing "obvious placeholder numbers -> nil (never echoed as a string)"
    (is (nil? (content/public-phone "+250 788 000 000")))
    (is (nil? (content/public-phone "+250 7xx xxx xxx"))))
  (testing "a real number passes through, trimmed"
    (is (= "+250 788 123 456" (content/public-phone "  +250 788 123 456 ")))))

(deftest property-response-includes-contact
  (let [resp (content/property-response {:name "Kigali Keys"}
                                        {:currency "USD" :nightlyRate 70}
                                        settings
                                        {:stayTerms 3 :houseRules 2}
                                        "2026-08-20T09:00:00Z")]
    (is (= "request" (:bookingMode resp)))
    (is (contains? resp :contact))
    (is (nil? (get-in resp [:contact :phone])))
    (is (= "Peter" (get-in resp [:contact :hostName])))))
