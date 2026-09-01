(ns kigali.sent-emails-test
  "§26b sent-email log (outbox) — read-only, owner + admin."
  (:require [clojure.set :as set]
            [clojure.string :as str]
            [clojure.test :refer [deftest is testing use-fixtures]]
            [kigali.db :as db]
            [kigali.test-helpers :as h :refer [request]]))

(use-fixtures :each h/with-system)

;; ---------------------------------------------------------------------------
;; Helpers

(defn- admin-cookie
  "Creates a non-owner admin, consumes the invite, returns their session cookie."
  []
  (let [owner (h/session-cookie)
        _ (request :post "/api/admin/users"
                   :body {:name "Aline" :email "aline@kigalikeys.rw" :role "admin"}
                   :cookie owner)
        token (:invite_token
               (db/q1 (:db h/*ctx*)
                      ["SELECT invite_token FROM admin_users WHERE email = ?"
                       "aline@kigalikeys.rw"]))
        r (request :post "/api/admin/auth/accept-invite"
                   :body {:token token :password "aline-admin-pass-123"})
        set-cookie (get-in r [:headers "Set-Cookie"])
        header (if (coll? set-cookie) (first set-cookie) set-cookie)]
    (first (str/split header #";"))))

(defn- current-hash []
  (get-in (request :get "/api/vehicle") [:body :agreement :bodyHash]))

(defn- make-booking!
  "Submits a booking, returns its reference."
  [first-name email check-in check-out]
  (let [b {:guest {:firstName first-name :lastName "Traveller" :email email
                   :phone "+250788123456" :countryOfResidence "RW" :purposeOfStay "leisure"}
           :stay {:checkIn check-in :checkOut check-out :adults 2 :children 0}
           :acceptances [{:type "stayTerms" :version 3 :accepted true}
                         {:type "houseRules" :version 3 :accepted true}]}
        r (request :post "/api/bookings" :body b :headers {"idempotency-key" (h/uuid)})]
    (is (= 201 (:status r)))
    (get-in r [:body :reference])))

(defn- approve! [cookie reference]
  (let [id (->> (request :get "/api/admin/bookings" :query {:status "pending"} :cookie cookie)
                :body :items (filter #(= reference (:reference %))) first :id)]
    (is (some? id))
    (is (= 200 (:status (request :post (str "/api/admin/bookings/" id "/approve")
                                 :body {:currency "USD"
                                        :lineItems [{:code "accommodation" :label "USD 70 x 5" :amount 350}
                                                    {:code "cleaningFee" :label "Cleaning fee" :amount 30}]
                                        :total 380
                                        :addressLine "House 12, KG 9 Ave, Gacuriro"
                                        :checkInInstructions "Lockbox 4821"
                                        :hostContact "Peter +250"
                                        :blockDates true}
                                 :headers {"idempotency-key" (h/uuid)}
                                 :cookie cookie))))))

(defn- contact! [name email]
  (is (= 202 (:status (request :post "/api/contact"
                               :body {:name name :email email :topic "other"
                                      :message "Just a general question, thanks."})))))

(defn- seed-emails!
  "Generates: bookingReceived + adminNewBooking + bookingApproved (ref set),
   and contactAck (ref null). Returns the booking reference."
  [cookie]
  (let [ref (make-booking! "Lena" "lena@example.com" "2026-11-05" "2026-11-10")]
    (approve! cookie ref)
    (contact! "Sam Field" "sam@example.com")
    ref))

;; ---------------------------------------------------------------------------
;; Tests

(deftest auth-required
  (testing "no session -> 401"
    (is (= 401 (:status (request :get "/api/admin/sent-emails"))))
    (is (= 401 (:status (request :get "/api/admin/sent-emails/eml_nope"))))))

(deftest non-owner-admin-allowed
  (let [c (admin-cookie)]
    (testing "a plain admin session gets 200, not 403 (this is owner + admin)"
      (let [r (request :get "/api/admin/sent-emails" :cookie c)]
        (is (= 200 (:status r)))
        (is (vector? (get-in r [:body :items])))))))

(deftest list-shape-and-order
  (let [c (h/session-cookie)
        _ (seed-emails! c)
        r (request :get "/api/admin/sent-emails" :cookie c)
        {:keys [items page pageSize total]} (:body r)]
    (is (= 200 (:status r)))
    (is (= 1 page))
    (is (= 20 pageSize))
    ;; bookingReceived + adminNewBooking + bookingApproved + contactAck + host notice
    (is (>= total 4))
    (is (= total (count items)))
    (testing "item shape"
      (is (= #{:id :toAddress :templateKey :subject :bookingReference :status :createdAt}
             (set (keys (first items))))))
    (testing "newest-first by createdAt"
      (is (= (reverse (sort (map :createdAt items))) (map :createdAt items))))
    (testing "v1 status is always 'stored'"
      (is (every? #(= "stored" (:status %)) items)))))

(deftest template-key-filter
  (let [c (h/session-cookie)
        _ (seed-emails! c)
        r (request :get "/api/admin/sent-emails"
                   :query {:templateKey "bookingApproved"} :cookie c)
        items (get-in r [:body :items])]
    (is (= 200 (:status r)))
    (is (seq items))
    (is (every? #(= "bookingApproved" (:templateKey %)) items))
    (is (= (:total (:body r)) (count items)))))

(deftest template-key-none-sentinel
  (let [c (h/session-cookie)
        _ (seed-emails! c)
        r (request :get "/api/admin/sent-emails"
                   :query {:templateKey "none"} :cookie c)
        items (get-in r [:body :items])]
    (is (= 200 (:status r)))
    (testing "?templateKey=none returns only rows with no template (the direct host notice)"
      (is (seq items))
      (is (every? #(nil? (:templateKey %)) items)))
    (testing "and excludes templated rows"
      (let [all (get-in (request :get "/api/admin/sent-emails" :cookie c) [:body :items])]
        (is (< (count items) (count all)))))))

(deftest q-matches-subject-and-reference
  (let [c (h/session-cookie)
        ref (seed-emails! c)]
    (testing "q matches subject text"
      (let [items (get-in (request :get "/api/admin/sent-emails"
                                   :query {:q "confirmed"} :cookie c)
                          [:body :items])]
        (is (seq items))
        (is (every? #(str/includes? (str/lower-case (:subject %)) "confirmed") items))))
    (testing "q matches booking reference"
      (let [items (get-in (request :get "/api/admin/sent-emails"
                                   :query {:q ref} :cookie c)
                          [:body :items])]
        (is (seq items))
        (is (every? #(= ref (:bookingReference %)) items))))
    (testing "q matches to-address"
      (let [items (get-in (request :get "/api/admin/sent-emails"
                                   :query {:q "sam@example.com"} :cookie c)
                          [:body :items])]
        (is (seq items))
        (is (every? #(= "sam@example.com" (:toAddress %)) items))))))

(deftest pagination-totals
  (let [c (h/session-cookie)
        _ (seed-emails! c)
        full (get-in (request :get "/api/admin/sent-emails" :cookie c) [:body :total])
        p1 (request :get "/api/admin/sent-emails" :query {:page 1 :pageSize 2} :cookie c)
        p2 (request :get "/api/admin/sent-emails" :query {:page 2 :pageSize 2} :cookie c)]
    (is (= full (get-in p1 [:body :total])))
    (is (= full (get-in p2 [:body :total])))
    (is (= 2 (count (get-in p1 [:body :items]))))
    (is (= 2 (:pageSize (:body p1))))
    (testing "pages do not overlap"
      (is (empty? (set/intersection
                   (set (map :id (get-in p1 [:body :items])))
                   (set (map :id (get-in p2 [:body :items])))))))))

(deftest detail-returns-html
  (let [c (h/session-cookie)
        _ (seed-emails! c)
        ;; pick a deterministic templated email — "first item" is non-deterministic
        ;; when contactAck and the direct host notice share a created_at second
        item (->> (request :get "/api/admin/sent-emails" :query {:templateKey "bookingApproved"} :cookie c)
                  :body :items first)
        d (request :get (str "/api/admin/sent-emails/" (:id item)) :cookie c)]
    (is (some? item))
    (is (= 200 (:status d)))
    (is (= #{:id :toAddress :templateKey :bookingReference :subject :html :status :createdAt}
           (set (keys (:body d)))))
    (is (str/includes? (get-in d [:body :html]) "<!doctype html>"))
    (is (str/includes? (get-in d [:body :html]) "Kigali Keys"))
    (is (= (:id item) (get-in d [:body :id])))))

(deftest unknown-id-404
  (let [c (h/session-cookie)
        d (request :get "/api/admin/sent-emails/eml_doesnotexist" :cookie c)]
    (is (= 404 (:status d)))
    (is (= "notFound" (get-in d [:body :error :code])))))

(deftest booking-reference-set-vs-null
  (let [c (h/session-cookie)
        ref (seed-emails! c)
        items (get-in (request :get "/api/admin/sent-emails" :query {:pageSize 100} :cookie c)
                      [:body :items])
        approved (first (filter #(= "bookingApproved" (:templateKey %)) items))
        ack (first (filter #(= "contactAck" (:templateKey %)) items))]
    (testing "booking-approved email carries the reference"
      (is (= ref (:bookingReference approved))))
    (testing "contactAck email has a null reference"
      (is (some? ack))
      (is (nil? (:bookingReference ack))))))
