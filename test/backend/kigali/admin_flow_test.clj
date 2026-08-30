(ns kigali.admin-flow-test
  (:require [clojure.test :refer [deftest is testing use-fixtures]]
            [kigali.db :as db]
            [kigali.test-helpers :as h :refer [request]]))

(use-fixtures :each h/with-system)

(deftest auth-and-role-enforcement
  (testing "no session -> 401 on admin endpoint"
    (is (= 401 (:status (request :get "/api/admin/bookings")))))
  (testing "login sets session, session endpoint works"
    (let [c (h/session-cookie)]
      (is (string? c))
      (is (= 200 (:status (request :get "/api/admin/auth/session" :cookie c))))
      (is (= 200 (:status (request :get "/api/admin/bookings" :cookie c))))))
  (testing "bad credentials -> 401 unauthorized"
    (let [{:keys [status body]} (request :post "/api/admin/auth/login"
                                         :body {:email "owner@kigalikeys.rw" :password "wrong"})]
      (is (= 401 status))
      (is (= "unauthorized" (get-in body [:error :code]))))))

(deftest pricing-update
  (let [c (h/session-cookie)]
    (is (= 200 (:status (request :put "/api/admin/pricing"
                                 :body {:nightlyRate 165 :cleaningFee 35 :minNights 3}
                                 :cookie c))))
    (is (= 165 (get-in (request :get "/api/availability"
                                :query {:from "2026-09-01" :to "2026-09-30"})
                       [:body :nightlyRate])))
    (testing "invalid pricing rejected"
      (is (= 422 (:status (request :put "/api/admin/pricing"
                                   :body {:nightlyRate 0 :cleaningFee 35 :minNights 3}
                                   :cookie c)))))))

(deftest availability-blocks
  (let [c (h/session-cookie)
        created (request :post "/api/admin/availability/blocks"
                         :body {:start "2026-10-01" :end "2026-10-05" :reason "Maintenance"}
                         :cookie c)]
    (is (= 201 (:status created)))
    (is (= ["2026-10-01" "2026-10-02" "2026-10-03" "2026-10-04"]
           (get-in (request :get "/api/availability" :query {:from "2026-09-15" :to "2026-10-15"})
                   [:body :unavailableDates])))
    (let [id (get-in created [:body :id])]
      (is (= 204 (:status (request :delete (str "/api/admin/availability/blocks/" id) :cookie c)))))))

(deftest approve-and-reject-flow
  (let [c (h/session-cookie)
        booking {:guest {:firstName "Sam" :lastName "Field" :email "sam@example.com"
                         :phone "+250788123456" :countryOfResidence "RW" :purposeOfStay "leisure"}
                 :stay {:checkIn "2026-11-05" :checkOut "2026-11-10" :adults 2 :children 0}
                 :acceptances [{:type "stayTerms" :version 3 :accepted true}
                               {:type "houseRules" :version 3 :accepted true}]}
        create (request :post "/api/bookings" :body booking :headers {"idempotency-key" (h/uuid)})
        _ (is (= 201 (:status create)))
        ref (get-in create [:body :reference])
        item (->> (request :get "/api/admin/bookings" :query {:status "pending"} :cookie c)
                  :body :items (filter #(= ref (:reference %))) first)
        id (:id item)]
    (testing "appears in admin queue"
      (is (some? id))
      (is (= 380 (:estimatedTotal item))))
    (testing "detail view has PII + acceptances + no conflicts"
      (let [d (request :get (str "/api/admin/bookings/" id) :cookie c)]
        (is (= "sam@example.com" (get-in d [:body :guest :email])))
        (is (= 2 (count (get-in d [:body :acceptances]))))
        (is (= [] (get-in d [:body :availabilityConflicts])))))
    (testing "approve needs idempotency key"
      (is (= 400 (:status (request :post (str "/api/admin/bookings/" id "/approve")
                                   :body {:currency "USD" :lineItems [] :total 0
                                          :addressLine "x" :checkInInstructions "y"}
                                   :cookie c)))))
    (testing "approve transitions and blocks dates"
      (let [ak (h/uuid)
            appr (request :post (str "/api/admin/bookings/" id "/approve")
                          :body {:currency "USD"
                                 :lineItems [{:code "accommodation" :label "USD 70 x 5 nights" :amount 350}
                                             {:code "cleaningFee" :label "Cleaning fee" :amount 35}]
                                 :total 385
                                 :paymentInstructions "50% bank transfer"
                                 :addressLine "House 12, KG 9 Ave, Gacuriro"
                                 :mapUrl "https://maps.example/x"
                                 :checkInInstructions "Lockbox 4821"
                                 :hostContact "Peter +250"
                                 :blockDates true}
                          :headers {"idempotency-key" ak} :cookie c)]
        (is (= 200 (:status appr)))
        (is (= "approved" (get-in appr [:body :status])))
        (is (= 385 (get-in appr [:body :approvalDetails :total])))
        (testing "replay approve with same key returns stored 200"
          (let [again (request :post (str "/api/admin/bookings/" id "/approve")
                               :body {:currency "USD"
                                      :lineItems [{:code "accommodation" :label "USD 70 x 5 nights" :amount 350}
                                                  {:code "cleaningFee" :label "Cleaning fee" :amount 35}]
                                      :total 385
                                      :paymentInstructions "50% bank transfer"
                                      :addressLine "House 12, KG 9 Ave, Gacuriro"
                                      :mapUrl "https://maps.example/x"
                                      :checkInInstructions "Lockbox 4821"
                                      :hostContact "Peter +250"
                                      :blockDates true}
                               :headers {"idempotency-key" ak} :cookie c)]
            (is (= 200 (:status again)))
            (is (= "true" (get-in again [:headers "Idempotency-Replayed"])))))
        (testing "second approve (new key) -> alreadyDecided"
          (let [dec (request :post (str "/api/admin/bookings/" id "/approve")
                             :body {:currency "USD" :lineItems [{:code "x" :label "x" :amount 1}]
                                    :total 1 :addressLine "a" :checkInInstructions "b"}
                             :headers {"idempotency-key" (h/uuid)} :cookie c)]
            (is (= 409 (:status dec)))
            (is (= "alreadyDecided" (get-in dec [:body :error :code])))))
        (testing "approved nights now unavailable publicly"
          (is (contains? (set (get-in (request :get "/api/availability"
                                               :query {:from "2026-11-01" :to "2026-11-30"})
                                      [:body :unavailableDates]))
                         "2026-11-05")))
        (testing "guest sees approved view with approvalDetails"
          (let [g (request :get (str "/api/bookings/" ref) :query {:email "sam@example.com"})]
            (is (= "approved" (get-in g [:body :status])))
            (is (= "House 12, KG 9 Ave, Gacuriro" (get-in g [:body :approvalDetails :addressLine])))
            (is (= "approved" (get-in g [:body :decision :type])))))))))

(deftest reject-flow
  (let [c (h/session-cookie)
        booking {:guest {:firstName "Ada" :lastName "N" :email "ada@example.com"
                         :phone "+250788999888" :countryOfResidence "RW" :purposeOfStay "business"}
                 :stay {:checkIn "2026-12-05" :checkOut "2026-12-09" :adults 1 :children 0}
                 :acceptances [{:type "stayTerms" :version 3 :accepted true}
                               {:type "houseRules" :version 3 :accepted true}]}
        create (request :post "/api/bookings" :body booking :headers {"idempotency-key" (h/uuid)})
        ref (get-in create [:body :reference])
        id (->> (request :get "/api/admin/bookings" :query {:status "pending"} :cookie c)
                :body :items (filter #(= ref (:reference %))) first :id)
        rej (request :post (str "/api/admin/bookings/" id "/reject")
                     :body {:explanation "Sorry, those exact dates are already committed elsewhere."
                            :internalNote "follow up"}
                     :headers {"idempotency-key" (h/uuid)} :cookie c)]
    (is (= 200 (:status rej)))
    (is (= "rejected" (get-in rej [:body :status])))
    (testing "rejecting never blocks dates"
      (is (not (contains? (set (get-in (request :get "/api/availability"
                                                :query {:from "2026-12-01" :to "2026-12-31"})
                                       [:body :unavailableDates]))
                          "2026-12-05"))))
    (testing "guest sees explanation, no approvalDetails"
      (let [g (request :get (str "/api/bookings/" ref) :query {:email "ada@example.com"})]
        (is (= "rejected" (get-in g [:body :status])))
        (is (re-find #"committed" (get-in g [:body :decision :explanation])))
        (is (nil? (get-in g [:body :decision :internalNote])) "internal note never leaks to the guest")
        (is (nil? (get-in g [:body :approvalDetails])))))
    (testing "short explanation rejected"
      (is (= 422 (:status (request :post (str "/api/admin/bookings/" id "/reject")
                                   :body {:explanation "no"}
                                   :headers {"idempotency-key" (h/uuid)} :cookie c)))))))

(deftest agreement-audit-log-populated-by-booking
  (let [c (h/session-cookie)
        vh (get-in (request :get "/api/vehicle") [:body :agreement :bodyHash])
        booking {:guest {:firstName "Cal" :lastName "R" :email "cal@example.com"
                         :phone "+250788111222" :countryOfResidence "KE" :purposeOfStay "relocation"}
                 :stay {:checkIn "2026-11-20" :checkOut "2026-11-24" :adults 1 :children 0}
                 :car {:requested true :pickUp "2026-11-20" :dropOff "2026-11-23"
                       :driver {:fullName "Cal R" :dateOfBirth "1985-01-01"
                                :licenceNumber "KEN99" :licenceCountry "KE" :meetsRequirements true}}
                 :acceptances [{:type "stayTerms" :version 3 :accepted true}
                               {:type "houseRules" :version 3 :accepted true}
                               {:type "vehicleRentalAgreement" :version 4 :bodyHash vh :accepted true}]}
        _ (request :post "/api/bookings" :body booking :headers {"idempotency-key" (h/uuid)})
        log (request :get "/api/admin/agreement-acceptances" :query {:type "vehicleRentalAgreement"} :cookie c)]
    (is (= 200 (:status log)))
    (is (pos? (:total (:body log))))
    (let [row (first (get-in log [:body :items]))
          detail (request :get (str "/api/admin/agreement-acceptances/" (:id row)) :cookie c)]
      (is (= "cal@example.com" (:acceptedByEmail row)))
      (is (= "203.0.113.7" (:ipAddress row)))
      (is (re-find #"Rental Agreement" (get-in detail [:body :documentSnapshot :bodyMarkdown]))))))

(deftest document-publish-bumps-terms-version
  (let [c (h/session-cookie)
        pub (request :post "/api/admin/documents/houseRules"
                     :body {:bodyMarkdown "# House Rules (new)\n\nBe excellent to each other."
                            :effectiveDate "2026-12-01"
                            :summaryPoints ["Be kind"]}
                     :cookie c)]
    (is (= 201 (:status pub)))
    (is (= 4 (:version (:body pub))))
    (is (= 4 (get-in (request :get "/api/property") [:body :termsVersions :houseRules])))
    (testing "a booking accepting the old house-rules version is now stale"
      (let [b {:guest {:firstName "Old" :lastName "V" :email "old@example.com"
                       :phone "+250788000111" :countryOfResidence "RW" :purposeOfStay "other"}
               :stay {:checkIn "2026-11-01" :checkOut "2026-11-05" :adults 1 :children 0}
               :acceptances [{:type "stayTerms" :version 3 :accepted true}
                             {:type "houseRules" :version 3 :accepted true}]}
            {:keys [status body]} (request :post "/api/bookings" :body b
                                           :headers {"idempotency-key" (h/uuid)})]
        (is (= 409 status))
        (is (= "agreementVersionStale" (get-in body [:error :code])))))))

(deftest owner-only-users-endpoint
  (let [c (h/session-cookie)]
    (is (= 200 (:status (request :get "/api/admin/users" :cookie c))))
    (testing "cannot delete last owner"
      (let [me (first (get-in (request :get "/api/admin/users" :cookie c) [:body :users]))]
        (is (= 409 (:status (request :delete (str "/api/admin/users/" (:id me)) :cookie c))))))
    (testing "invite creates invited user"
      (let [r (request :post "/api/admin/users"
                       :body {:name "Aline" :email "aline@kigalikeys.rw" :role "admin"}
                       :cookie c)]
        (is (= 201 (:status r)))
        (is (= "invited" (get-in r [:body :status])))))))

(deftest accept-invite-flow
  (let [c (h/session-cookie)
        _ (request :post "/api/admin/users"
                   :body {:name "Aline" :email "aline@kigalikeys.rw" :role "admin"} :cookie c)
        token (:invite_token (db/q1 (:db h/*ctx*)
                                    ["SELECT invite_token FROM admin_users WHERE email = ?"
                                     "aline@kigalikeys.rw"]))]
    (testing "invalid token -> 410 conflict (§13b), not 401"
      (let [{:keys [status body]} (request :post "/api/admin/auth/accept-invite"
                                           :body {:token "not-a-real-token" :password "longenough123"})]
        (is (= 410 status))
        (is (= "conflict" (get-in body [:error :code])))))
    (testing "weak password still -> 422 validationError"
      (is (= 422 (:status (request :post "/api/admin/auth/accept-invite"
                                   :body {:token token :password "short"})))))
    (testing "happy path: invited -> active + session, then token is burned"
      (let [ok (request :post "/api/admin/auth/accept-invite"
                        :body {:token token :password "brandnewpass123"})]
        (is (= 200 (:status ok)))
        (is (= "aline@kigalikeys.rw" (get-in ok [:body :user :email])))
        (is (= "active" (:status (db/q1 (:db h/*ctx*)
                                        ["SELECT status FROM admin_users WHERE email = ?"
                                         "aline@kigalikeys.rw"]))))
        (testing "reusing the burned token -> 410 conflict"
          (let [again (request :post "/api/admin/auth/accept-invite"
                               :body {:token token :password "anotherpass123"})]
            (is (= 410 (:status again)))
            (is (= "conflict" (get-in again [:body :error :code])))))))))
