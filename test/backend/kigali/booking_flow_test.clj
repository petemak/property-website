(ns kigali.booking-flow-test
  (:require [clojure.test :refer [deftest is testing use-fixtures]]
            [kigali.test-helpers :as h :refer [request]]))

(use-fixtures :each h/with-system)

(def base-booking
  {:guest {:firstName "Lena" :lastName "Okafor" :email "lena@example.com"
           :phone "+2348012345678" :countryOfResidence "NG" :purposeOfStay "remoteWork"}
   :stay {:checkIn "2026-09-05" :checkOut "2026-09-12" :adults 2 :children 0}
   :message "Arriving around 19:00."
   :car {:requested true :pickUp "2026-09-06" :dropOff "2026-09-10"
         :driver {:fullName "Lena Okafor" :dateOfBirth "1990-04-12"
                  :licenceNumber "A1234567" :licenceCountry "NG" :meetsRequirements true}}
   :acceptances [{:type "stayTerms" :version 3 :accepted true}
                 {:type "houseRules" :version 2 :accepted true}
                 {:type "vehicleRentalAgreement" :version 4
                  :bodyHash "PLACEHOLDER" :accepted true}]})

(defn- current-hash []
  (get-in (request :get "/api/vehicle") [:body :agreement :bodyHash]))

(defn- booking-with-hash []
  (assoc-in base-booking [:acceptances 2 :bodyHash] (current-hash)))

(deftest public-reads
  (testing "GET /property has managed fields"
    (let [{:keys [status body]} (request :get "/api/property")]
      (is (= 200 status))
      (is (= "request" (:bookingMode body)))
      (is (= 3 (get-in body [:termsVersions :stayTerms])))
      (is (= 70 (get-in body [:pricing :nightlyRate])))))
  (testing "GET /vehicle exposes minDriverAge + agreement"
    (let [{:keys [body]} (request :get "/api/vehicle")]
      (is (= 23 (:minDriverAge body)))
      (is (= 4 (get-in body [:agreement :version])))))
  (testing "GET /gallery sorted, has lead"
    (let [{:keys [body]} (request :get "/api/gallery")]
      (is (some? (:leadImageId body)))
      (is (= (sort (map :position (:images body))) (map :position (:images body))))))
  (testing "GET /documents/:type/current"
    (is (= 200 (:status (request :get "/api/documents/privacy/current"))))
    (is (= 404 (:status (request :get "/api/documents/privacy/99"))))))

(deftest booking-requires-idempotency-key
  (let [{:keys [status body]} (request :post "/api/bookings" :body (booking-with-hash))]
    (is (= 400 status))
    (is (= "idempotencyKeyMissing" (get-in body [:error :code])))))

(deftest booking-happy-path-and-replay
  (let [key (h/uuid)
        r1 (request :post "/api/bookings" :body (booking-with-hash)
                    :headers {"idempotency-key" key})]
    (is (= 201 (:status r1)))
    (is (= "pending" (get-in r1 [:body :status])))
    ;; 7 nights x USD 70 + USD 35 cleaning + 4 car days x USD 45 = 705
    (is (= 705 (get-in r1 [:body :estimate :estimatedTotal])))
    (is (= 3 (count (get-in r1 [:body :acceptancesRecorded]))))
    (is (nil? (get-in r1 [:body :car :driver])) "licence data never echoed")
    (let [ref (get-in r1 [:body :reference])
          r2 (request :post "/api/bookings" :body (booking-with-hash)
                      :headers {"idempotency-key" key})]
      (testing "same key replays the same reference, no second booking"
        (is (= 201 (:status r2)))
        (is (= ref (get-in r2 [:body :reference])))
        (is (= "true" (get-in r2 [:headers "Idempotency-Replayed"]))))
      (testing "different body, same key -> conflict"
        (is (= "idempotencyKeyConflict"
               (get-in (request :post "/api/bookings"
                                :body (assoc-in (booking-with-hash) [:stay :adults] 3)
                                :headers {"idempotency-key" key})
                       [:body :error :code]))))
      (testing "guest status lookup by email"
        (let [g (request :get (str "/api/bookings/" ref) :query {:email "lena@example.com"})]
          (is (= 200 (:status g)))
          (is (= "pending" (get-in g [:body :status])))
          (is (seq (get-in g [:body :estimate :lineItems])) "line items populated")
          (is (= 3 (count (get-in g [:body :acceptedDocuments]))))))
      (testing "wrong email -> 404 notFound"
        (is (= 404 (:status (request :get (str "/api/bookings/" ref)
                                     :query {:email "nope@example.com"}))))))))

(deftest booking-agreement-rules
  (testing "missing house rules acceptance -> agreementRequired"
    (let [b (update (booking-with-hash) :acceptances
                    (fn [as] (remove #(= "houseRules" (:type %)) as)))
          {:keys [status body]} (request :post "/api/bookings" :body b
                                         :headers {"idempotency-key" (h/uuid)})]
      (is (= 422 status))
      (is (= "agreementRequired" (get-in body [:error :code])))))
  (testing "stale stay-terms version -> agreementVersionStale"
    (let [b (assoc-in (booking-with-hash) [:acceptances 0 :version] 2)
          {:keys [status body]} (request :post "/api/bookings" :body b
                                         :headers {"idempotency-key" (h/uuid)})]
      (is (= 409 status))
      (is (= "agreementVersionStale" (get-in body [:error :code])))))
  (testing "wrong vehicle bodyHash -> agreementVersionStale"
    (let [b (assoc-in (booking-with-hash) [:acceptances 2 :bodyHash] "sha256:deadbeef")
          {:keys [body]} (request :post "/api/bookings" :body b
                                  :headers {"idempotency-key" (h/uuid)})]
      (is (= "agreementVersionStale" (get-in body [:error :code]))))))

(deftest booking-validation
  (testing "past check-in"
    (let [b (-> (booking-with-hash)
                (assoc-in [:stay :checkIn] "2020-01-01")
                (assoc-in [:stay :checkOut] "2020-01-10"))]
      (is (= 422 (:status (request :post "/api/bookings" :body b
                                   :headers {"idempotency-key" (h/uuid)}))))))
  (testing "driver too young"
    (let [b (assoc-in (booking-with-hash) [:car :driver :dateOfBirth] "2015-01-01")
          {:keys [status body]} (request :post "/api/bookings" :body b
                                         :headers {"idempotency-key" (h/uuid)})]
      (is (= 422 status))
      (is (= "validationError" (get-in body [:error :code]))))))

(deftest rate-limiting-bookings
  ;; fixture sets max-requests 3 per window
  (dotimes [_ 3]
    (request :post "/api/bookings" :body {:bad true} :headers {"idempotency-key" (h/uuid)}))
  (let [{:keys [status body]} (request :post "/api/bookings" :body {:bad true}
                                       :headers {"idempotency-key" (h/uuid)})]
    (is (= 429 status))
    (is (= "rateLimited" (get-in body [:error :code])))))
