(ns kigali.settings-test
  "§28 GET/PUT /admin/settings — publicPhone is optional, nullable and
   clearable; blank strings are stored as nil (QA blocker regression)."
  (:require [clojure.test :refer [deftest is testing use-fixtures]]
            [kigali.features.settings :as settings]
            [kigali.test-helpers :as h :refer [request]]))

(use-fixtures :each h/with-system)

(def ^:private base
  {:hostDisplayName "Peter"
   :publicEmail "info@kigalikeys.rw"
   :newRequestNotificationEmails ["info@kigalikeys.rw"]
   :timezone "Africa/Kigali"
   :currency "USD"
   :approxLat -1.93
   :approxLng 30.093
   :revealExactAddressAfterApproval true
   :guestResponseTimeText "Typically within 24-48 hours"})

(defn- put-settings [cookie body]
  (request :put "/api/admin/settings" :body body :cookie cookie))

(defn- get-settings [cookie]
  (:body (request :get "/api/admin/settings" :cookie cookie)))

(deftest normalize-coerces-blank-phone-to-nil
  (testing "pure normalisation of publicPhone"
    (is (nil? (:publicPhone (settings/normalize (dissoc base :publicPhone)))))
    (is (nil? (:publicPhone (settings/normalize (assoc base :publicPhone nil)))))
    (is (nil? (:publicPhone (settings/normalize (assoc base :publicPhone "")))))
    (is (nil? (:publicPhone (settings/normalize (assoc base :publicPhone "   ")))))
    (is (= "+250 788 123 456"
           (:publicPhone (settings/normalize (assoc base :publicPhone "  +250 788 123 456 ")))))))

(deftest normalize-coerces-blank-response-time-to-nil
  (testing "pure normalisation of guestResponseTimeText"
    (is (nil? (:guestResponseTimeText (settings/normalize (dissoc base :guestResponseTimeText)))))
    (is (nil? (:guestResponseTimeText (settings/normalize (assoc base :guestResponseTimeText nil)))))
    (is (nil? (:guestResponseTimeText (settings/normalize (assoc base :guestResponseTimeText "")))))
    (is (nil? (:guestResponseTimeText (settings/normalize (assoc base :guestResponseTimeText "   ")))))
    (is (= "Within a day"
           (:guestResponseTimeText (settings/normalize (assoc base :guestResponseTimeText "  Within a day ")))))))

(deftest put-settings-public-phone-optional-and-nullable
  (let [c (h/session-cookie)]
    (testing "publicPhone omitted -> 200, stored nil"
      (is (= 200 (:status (put-settings c (dissoc base :publicPhone)))))
      (is (nil? (:publicPhone (get-settings c)))))
    (testing "publicPhone null -> 200, stored nil"
      (is (= 200 (:status (put-settings c (assoc base :publicPhone nil)))))
      (is (nil? (:publicPhone (get-settings c)))))
    (testing "publicPhone empty string -> 200, stored nil (GET returns null)"
      (is (= 200 (:status (put-settings c (assoc base :publicPhone "")))))
      (is (nil? (:publicPhone (get-settings c)))))
    (testing "publicPhone whitespace-only -> 200, stored nil"
      (is (= 200 (:status (put-settings c (assoc base :publicPhone "   ")))))
      (is (nil? (:publicPhone (get-settings c)))))
    (testing "real number -> 200, stored trimmed"
      (is (= 200 (:status (put-settings c (assoc base :publicPhone "  +250 788 123 456 ")))))
      (is (= "+250 788 123 456" (:publicPhone (get-settings c)))))
    (testing "60-char phone -> 422"
      (let [{:keys [status body]} (put-settings c (assoc base :publicPhone (apply str (repeat 60 "1"))))]
        (is (= 422 status))
        (is (= "validationError" (get-in body [:error :code])))))))

(deftest put-settings-response-time-text-optional-and-nullable
  (let [c (h/session-cookie)]
    (testing "guestResponseTimeText omitted -> 200, stored nil"
      (is (= 200 (:status (put-settings c (dissoc base :guestResponseTimeText)))))
      (is (nil? (:guestResponseTimeText (get-settings c)))))
    (testing "guestResponseTimeText null -> 200, stored nil"
      (is (= 200 (:status (put-settings c (assoc base :guestResponseTimeText nil)))))
      (is (nil? (:guestResponseTimeText (get-settings c)))))
    (testing "guestResponseTimeText empty string -> 200, stored nil"
      (is (= 200 (:status (put-settings c (assoc base :guestResponseTimeText "")))))
      (is (nil? (:guestResponseTimeText (get-settings c)))))
    (testing "a set value -> 200, stored trimmed"
      (is (= 200 (:status (put-settings c (assoc base :guestResponseTimeText "  Within a day ")))))
      (is (= "Within a day" (:guestResponseTimeText (get-settings c)))))
    (testing "over 200 chars -> 422"
      (is (= 422 (:status (put-settings c (assoc base :guestResponseTimeText (apply str (repeat 201 "x"))))))))))

(deftest settings-with-no-phone-round-trips-to-property-contact
  (let [c (h/session-cookie)]
    (is (= 200 (:status (put-settings c (assoc base :publicPhone "")))))
    (let [contact (get-in (request :get "/api/property") [:body :contact])]
      (is (contains? contact :phone))
      (is (nil? (:phone contact))))))

(deftest settings-with-no-response-time-round-trips-to-property-contact
  (let [c (h/session-cookie)]
    (is (= 200 (:status (put-settings c (assoc base :guestResponseTimeText nil)))))
    (let [contact (get-in (request :get "/api/property") [:body :contact])]
      (is (nil? (:responseTimeText contact))))))
