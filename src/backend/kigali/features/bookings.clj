(ns kigali.features.bookings
  "§6 create booking, §7 guest status lookup, §14 admin list, §15 admin detail,
   §16 approve, §17 reject.

   The backend is the only writer of booking.status. v1 states:
   pending -> approved | rejected | cancelled | expired. `confirmed` is reserved
   for v2 and never emitted here. No payment code."
  (:require [clojure.string :as str]
            [clojure.tools.logging :as log]
            [kigali.db :as db]
            [kigali.features.agreements :as agreements]
            [kigali.features.notifications :as notify]
            [kigali.middleware :as mw]
            [kigali.pricing :as pricing]
            [kigali.respond :as respond]
            [kigali.sanitize :as sanitize]
            [kigali.store :as store]
            [kigali.tokens :as tokens]
            [kigali.util :as util]))

(def ^:private date-re [:re #"^\d{4}-\d{2}-\d{2}$"])

;; ---------------------------------------------------------------------------
;; Request schema

(def booking-schema
  [:map {:closed false}
   [:guest [:map {:closed false}
            [:firstName [:string {:min 1 :max 80}]]
            [:lastName [:string {:min 1 :max 80}]]
            [:email [:fn {:error/message "must be a valid email"} util/email?]]
            [:phone [:fn {:error/message "must be a valid phone number"} util/phone?]]
            [:countryOfResidence [:fn {:error/message "must be a 2-letter country code"} util/alpha2?]]
            [:purposeOfStay [:enum "remoteWork" "leisure" "business" "relocation" "other"]]]]
   [:stay [:map {:closed false}
           [:checkIn date-re]
           [:checkOut date-re]
           [:adults [:int {:min 1}]]
           [:children [:int {:min 0}]]]]
   [:message {:optional true} [:maybe [:string {:max 2000}]]]
   [:car {:optional true}
    [:map {:closed false}
     [:requested :boolean]
     [:pickUp {:optional true} [:maybe date-re]]
     [:dropOff {:optional true} [:maybe date-re]]
     [:driver {:optional true}
      [:maybe [:map {:closed false}
               [:fullName [:string {:min 1 :max 120}]]
               [:dateOfBirth date-re]
               [:licenceNumber [:string {:min 3 :max 40}]]
               [:licenceCountry [:fn {:error/message "must be a 2-letter country code"} util/alpha2?]]
               [:meetsRequirements :boolean]]]]]]
   [:acceptances [:sequential [:map {:closed false}
                               [:type :string]
                               [:version :int]
                               [:bodyHash {:optional true} [:maybe :string]]
                               [:accepted :boolean]]]]
   [:quoteEcho {:optional true} :any]])

;; ---------------------------------------------------------------------------
;; Acceptance checks (pure-ish; read current versions from the store)

(defn- find-acceptance [acceptances t]
  (first (filter #(= (:type %) t) acceptances)))

(defn check-acceptance!
  "Enforces one required acceptance against the server's current version.
   Returns {:type :version :body-hash :snapshot-id} for the acceptance row."
  [acceptances doc-type current-doc {:keys [require-hash?]}]
  (let [a (find-acceptance acceptances doc-type)]
    (cond
      (or (nil? a) (not (:accepted a)))
      (respond/throw-error! :agreementRequired
                            (str "You must accept the " doc-type " to continue."))

      (not= (:version a) (:version current-doc))
      (respond/throw-error! :agreementVersionStale
                            (str "The " doc-type " has been updated — please review and accept version "
                                 (:version current-doc) "."))

      (and require-hash? (not= (:bodyHash a) (:bodyHash current-doc)))
      (respond/throw-error! :agreementVersionStale
                            (str "The " doc-type " text has changed — please review and accept it again."))

      :else {:type doc-type
             :version (:version current-doc)
             :body-hash (:bodyHash current-doc)
             :snapshot-id (:snapshotId current-doc)})))

(defn required-acceptances!
  "Returns the acceptance descriptors to persist for this booking."
  [db acceptances car-requested?]
  (cond-> [(check-acceptance! acceptances "stayTerms" (store/current-doc db "stayTerms") {})
           (check-acceptance! acceptances "houseRules" (store/current-doc db "houseRules") {})]
    car-requested?
    (conj (check-acceptance! acceptances "vehicleRentalAgreement"
                             (store/current-doc db "vehicleRentalAgreement")
                             {:require-hash? true}))))

;; ---------------------------------------------------------------------------
;; Semantic validation

(defn- validate-booking! [db property vehicle {:keys [stay car] :as body}]
  (let [ci (util/parse-date (:checkIn stay))]
    (when (.isBefore ci (util/today))
      (respond/throw-error! :validationError "checkIn cannot be in the past."))
    (let [guests (+ (:adults stay) (:children stay))
          car-req? (boolean (get-in body [:car :requested]))
          quote-req {:checkIn (:checkIn stay)
                     :checkOut (:checkOut stay)
                     :guests guests
                     :car (when car-req?
                            {:requested true :pickUp (:pickUp car) :dropOff (:dropOff car)})}
          q (pricing/compute-quote (store/pricing db) vehicle (:maxGuests property) quote-req)]
      (when car-req?
        (let [driver (:driver car)]
          (when-not driver
            (respond/throw-error! :validationError "Driver details are required when the car is added."))
          (when-not (true? (:meetsRequirements driver))
            (respond/throw-error! :validationError "driver.meetsRequirements must be true."))
          (let [dob (util/parse-date (:dateOfBirth driver))
                min-age (:minDriverAge vehicle 23)]
            (when (or (nil? dob) (< (util/age-years dob (util/today)) min-age))
              (respond/throw-error! :validationError
                                    (str "The primary driver must be at least " min-age " years old."))))))
      q)))

;; ---------------------------------------------------------------------------
;; Persistence

(defn- row->driver [row]
  (when (util/->bool (:car_requested row))
    {:fullName (:driver_full_name row)
     :dateOfBirth (:driver_date_of_birth row)
     :licenceNumber (:driver_licence_number row)
     :licenceCountry (:driver_licence_country row)
     :meetsRequirements (util/->bool (:driver_meets_requirements row))}))

(defn- row->car-public [row]
  (if (util/->bool (:car_requested row))
    {:requested true :pickUp (:car_pick_up row) :dropOff (:car_drop_off row)}
    {:requested false}))

(defn- estimate-view [row]
  (let [e (util/<-json (:estimate_json row))]
    {:currency (:currency e) :lineItems (:lineItems e) :estimatedTotal (:estimatedTotal e)}))

(defn- get-booking-row [dbc ref-or-id by]
  (db/q1 dbc [(str "SELECT * FROM bookings WHERE " (name by) " = ?") ref-or-id]))

(defn insert-booking!
  [dbc {:keys [reference status-token guest stay message car estimate car-days]}]
  (let [id (util/short-id "bkg")
        now (util/now-iso)
        driver (:driver car)
        car-req? (boolean (:requested car))]
    (db/exec! dbc
              ["INSERT INTO bookings
                (id, reference, status, submitted_at, guest_first_name, guest_last_name,
                 guest_email, guest_phone, guest_country, purpose_of_stay,
                 check_in, check_out, nights, adults, children, message,
                 car_requested, car_pick_up, car_drop_off, car_days,
                 driver_full_name, driver_date_of_birth, driver_licence_number,
                 driver_licence_country, driver_meets_requirements,
                 estimate_json, status_token, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
               id reference "pending" now
               (:firstName guest) (:lastName guest) (:email guest) (:phone guest)
               (str/upper-case (:countryOfResidence guest)) (:purposeOfStay guest)
               (:checkIn stay) (:checkOut stay) (:nights estimate)
               (:adults stay) (:children stay) (some-> message sanitize/plain)
               (util/->bit car-req?) (when car-req? (:pickUp car)) (when car-req? (:dropOff car))
               (or car-days 0)
               (when car-req? (:fullName driver))
               (when car-req? (:dateOfBirth driver))
               (when car-req? (:licenceNumber driver))
               (when car-req? (some-> (:licenceCountry driver) str/upper-case))
               (when car-req? (util/->bit (:meetsRequirements driver)))
               (util/->json estimate) status-token now now])
    id))

(defn- log-activity! [dbc booking-id actor event detail]
  (db/exec! dbc ["INSERT INTO booking_activity (id, booking_id, at, actor, event, detail)
                  VALUES (?,?,?,?,?,?)"
                 (util/short-id "act") booking-id (util/now-iso) actor event detail]))

(defn add-block! [dbc scope booking-id booking-ref start end reason]
  (db/exec! dbc ["INSERT INTO availability_blocks
                  (id, scope, start_date, end_date, reason, source, booking_id, booking_reference, created_at)
                  VALUES (?,?,?,?,?,?,?,?,?)"
                 (util/short-id "blk") scope start end reason "booking" booking-id booking-ref
                 (util/now-iso)]))

;; ---------------------------------------------------------------------------
;; Email context

(defn- price-breakdown-text [estimate]
  (let [cur (:currency estimate)]
    (str/join "\n"
              (concat
               (map (fn [li] (str "- " (:label li) ": " cur " " (:amount li)))
                    (:lineItems estimate))
               [(str "Total: " cur " " (or (:total estimate) (:estimatedTotal estimate)))]))))

(defn- stay-dates-text [row]
  (str (:check_in row) " to " (:check_out row)))

;; ---------------------------------------------------------------------------
;; §6 create

(defn- create-booking [ctx req]
  (let [db (:db ctx)
        body (mw/validate! booking-schema (:body-params req))
        property (store/property-doc db)
        vehicle (store/vehicle-doc db)
        car-req? (boolean (get-in body [:car :requested]))
        q (validate-booking! db property vehicle body)
        accept-descriptors (required-acceptances! db (:acceptances body) car-req?)]
    ;; quoteEcho is advisory only in v1
    (when-let [echo (:quoteEcho body)]
      (when (and (:estimatedTotal echo) (not= (:estimatedTotal echo) (:estimatedTotal q)))
        (log/warn "quoteEcho mismatch" {:echo (:estimatedTotal echo) :computed (:estimatedTotal q)})))
    (let [secret (get-in ctx [:config :secrets :token-secret])
          estimate (assoc (pricing/quote->estimate q)
                          :estimatedSubtotal (:estimatedSubtotal q)
                          :nights (:nights q)
                          :carDays (:carDays q))
          result
          (db/tx
           db
           (fn [t]
             (let [reference (loop [tries 0]
                               (let [r (util/booking-reference)]
                                 (if (or (get-booking-row t r :reference) (> tries 5))
                                   (if (> tries 5) (str r (rand-int 9)) (recur (inc tries)))
                                   r)))
                   status-token (tokens/sign-booking-token secret reference)
                   booking-id (insert-booking! t {:reference reference
                                                  :status-token status-token
                                                  :guest (:guest body)
                                                  :stay (:stay body)
                                                  :message (:message body)
                                                  :car (:car body)
                                                  :estimate estimate
                                                  :car-days (:carDays q)})
                   accepted-at (util/now-iso)
                   recorded (agreements/record-acceptances!
                             t {:booking-id booking-id
                                :booking-reference reference
                                :accepted-by-name (str (get-in body [:guest :firstName]) " "
                                                       (get-in body [:guest :lastName]))
                                :accepted-by-email (get-in body [:guest :email])
                                :ip-address (:remote-addr req)
                                :user-agent (get-in req [:headers "user-agent"])
                                :accepted-at accepted-at
                                :documents accept-descriptors})]
               (log-activity! t booking-id "guest" "submitted" nil)
               {:booking-id booking-id
                :reference reference
                :status-token status-token
                :submitted-at accepted-at
                :estimate estimate
                :recorded recorded})))
          {:keys [reference status-token submitted-at recorded estimate]} result
          status-url (str "/booking/" reference)]
      ;; side-effect emails (outside the tx)
      (let [ctx-map {:guestFirstName (get-in body [:guest :firstName])
                     :bookingReference reference
                     :stayDates (str (get-in body [:stay :checkIn]) " to " (get-in body [:stay :checkOut]))
                     :priceBreakdown (price-breakdown-text estimate)
                     :statusUrl (str status-url "?token=" status-token)}]
        (notify/send-email! ctx :bookingReceived (get-in body [:guest :email]) ctx-map)
        (doseq [to (:newRequestNotificationEmails (store/settings db))]
          (notify/send-email! ctx :adminNewBooking to ctx-map)))
      (respond/created
       {:reference reference
        :status "pending"
        :submittedAt submitted-at
        :stay {:checkIn (get-in body [:stay :checkIn])
               :checkOut (get-in body [:stay :checkOut])
               :nights (:nights estimate)
               :adults (get-in body [:stay :adults])
               :children (get-in body [:stay :children])}
        :car (if car-req?
               {:requested true
                :pickUp (get-in body [:car :pickUp])
                :dropOff (get-in body [:car :dropOff])
                :driverName (get-in body [:car :driver :fullName])}
               {:requested false})
        :estimate {:currency (:currency estimate)
                   :lineItems (:lineItems estimate)
                   :estimatedTotal (:estimatedTotal estimate)}
        :acceptancesRecorded (mapv #(select-keys % [:id :type :version :acceptedAt]) recorded)
        :statusUrl status-url
        :statusTokenSent true}))))

;; ---------------------------------------------------------------------------
;; §7 guest status lookup

(defn- accepted-documents [dbc booking-id]
  (mapv (fn [r] {:type (:doc_type r)
                 :version (:version r)
                 :acceptedAt (:accepted_at r)
                 :documentUrl (str "/api/documents/" (:doc_type r) "/" (:version r))})
        (agreements/acceptances-for-booking dbc booking-id)))

(defn- guest-decision
  "Guest-facing decision: never expose the admin-only internalNote."
  [decision]
  (when decision
    (select-keys decision [:type :decidedAt :explanation])))

(defn- guest-view [dbc row]
  (let [decision (guest-decision (util/<-json (:decision_json row)))
        approval (util/<-json (:approval_details_json row))
        base {:reference (:reference row)
              :status (:status row)
              :submittedAt (:submitted_at row)
              :stay {:checkIn (:check_in row) :checkOut (:check_out row)
                     :nights (:nights row) :adults (:adults row) :children (:children row)}
              :car (row->car-public row)
              :estimate (estimate-view row)
              :decision decision
              :acceptedDocuments (accepted-documents dbc (:id row))}]
    (cond-> base
      (= "approved" (:status row)) (assoc :approvalDetails approval))))

(defn- lookup-booking [ctx req]
  (let [db (:db ctx)
        reference (get-in req [:path-params :reference])
        qp (:query-params req)
        email (get qp "email")
        token (get qp "token")
        secret (get-in ctx [:config :secrets :token-secret])
        row (get-booking-row db reference :reference)
        ok? (and row
                 (or (and email (= (str/lower-case email) (str/lower-case (:guest_email row))))
                     (and token (= reference (tokens/verify-booking-token secret token)))))]
    (if ok?
      (respond/ok (guest-view db row))
      (respond/error :notFound "We couldn't find that booking."))))

;; ---------------------------------------------------------------------------
;; §14 admin list

(defn- list-item [row]
  {:id (:id row)
   :reference (:reference row)
   :guestName (str (:guest_first_name row) " " (:guest_last_name row))
   :guestEmail (:guest_email row)
   :submittedAt (:submitted_at row)
   :checkIn (:check_in row)
   :checkOut (:check_out row)
   :nights (:nights row)
   :guests (+ (:adults row) (:children row))
   :carRequested (util/->bool (:car_requested row))
   :status (:status row)
   :estimatedTotal (:estimatedTotal (util/<-json (:estimate_json row)))
   :currency (:currency (util/<-json (:estimate_json row)))})

(defn- admin-list [ctx req]
  (let [db (:db ctx)
        qp (:query-params req)
        status (get qp "status" "pending")
        page (max 1 (or (parse-long (str (get qp "page" "1"))) 1))
        size (min 100 (max 1 (or (parse-long (str (get qp "pageSize" "20"))) 20)))
        offset (* (dec page) size)
        clauses (cond-> ["1=1"]
                  (not= status "all") (conj "status = ?")
                  (get qp "from") (conj "check_in >= ?")
                  (get qp "to") (conj "check_in <= ?")
                  (= (get qp "car") "true") (conj "car_requested = 1")
                  (= (get qp "car") "false") (conj "car_requested = 0")
                  (get qp "q") (conj "(lower(guest_first_name || ' ' || guest_last_name) LIKE ? OR lower(guest_email) LIKE ? OR upper(reference) LIKE ?)"))
        params (cond-> []
                 (not= status "all") (conj status)
                 (get qp "from") (conj (get qp "from"))
                 (get qp "to") (conj (get qp "to"))
                 (get qp "q") (into (let [t (get qp "q")]
                                     [(str "%" (str/lower-case t) "%")
                                      (str "%" (str/lower-case t) "%")
                                      (str "%" (str/upper-case t) "%")])))
        where (str/join " AND " clauses)
        total (:c (db/q1 db (into [(str "SELECT COUNT(*) AS c FROM bookings WHERE " where)] params)))
        rows (db/q db (into [(str "SELECT * FROM bookings WHERE " where
                                  " ORDER BY submitted_at DESC LIMIT ? OFFSET ?")]
                            (concat params [size offset])))]
    (respond/ok {:items (mapv list-item rows) :page page :pageSize size :total total})))

;; ---------------------------------------------------------------------------
;; §15 admin detail

(defn- availability-conflicts [dbc row]
  (let [ci (util/parse-date (:check_in row))
        co (util/parse-date (:check_out row))
        nights (set (util/date-seq ci co))
        blocks (db/q dbc ["SELECT * FROM availability_blocks
                           WHERE scope = 'stay' AND start_date < ? AND end_date > ?
                             AND (booking_id IS NULL OR booking_id <> ?)"
                          (:check_out row) (:check_in row) (:id row)])]
    (->> blocks
         (mapcat (fn [b]
                   (let [reason (if (= "booking" (:source b)) "approvedBooking" "manualBlock")]
                     (for [d (util/date-seq (util/parse-date (:start_date b))
                                            (util/parse-date (:end_date b)))
                           :when (nights d)]
                       {:date d :reason reason}))))
         (distinct)
         (sort-by :date)
         vec)))

(defn admin-detail-view [dbc row]
  (let [decision (util/<-json (:decision_json row))
        approval (util/<-json (:approval_details_json row))
        acc (mapv (fn [r]
                    {:id (:id r) :type (:doc_type r) :version (:version r)
                     :bodyHash (:body_hash r)
                     :acceptedByName (:accepted_by_name r)
                     :acceptedByEmail (:accepted_by_email r)
                     :acceptedAt (:accepted_at r)
                     :ipAddress (:ip_address r)
                     :userAgent (:user_agent r)
                     :documentUrl (str "/api/documents/" (:doc_type r) "/" (:version r))})
                  (agreements/acceptances-for-booking dbc (:id row)))
        activity (mapv (fn [a] (cond-> {:at (:at a) :actor (:actor a) :event (:event a)}
                                 (:detail a) (assoc :detail (:detail a))))
                       (db/q dbc ["SELECT * FROM booking_activity WHERE booking_id = ? ORDER BY at" (:id row)]))]
    (cond-> {:id (:id row)
             :reference (:reference row)
             :status (:status row)
             :submittedAt (:submitted_at row)
             :guest {:firstName (:guest_first_name row)
                     :lastName (:guest_last_name row)
                     :email (:guest_email row)
                     :phone (:guest_phone row)
                     :countryOfResidence (:guest_country row)
                     :purposeOfStay (:purpose_of_stay row)}
             :stay {:checkIn (:check_in row) :checkOut (:check_out row)
                    :nights (:nights row) :adults (:adults row) :children (:children row)}
             :message (:message row)
             :car (if (util/->bool (:car_requested row))
                    {:requested true
                     :pickUp (:car_pick_up row)
                     :dropOff (:car_drop_off row)
                     :carDays (:car_days row)
                     :driver (row->driver row)}
                    {:requested false})
             :estimate (estimate-view row)
             :availabilityConflicts (availability-conflicts dbc row)
             :acceptances acc
             :decision decision
             :activityLog activity}
      (= "approved" (:status row)) (assoc :approvalDetails approval))))

(defn- admin-get [ctx req]
  (let [db (:db ctx)
        row (get-booking-row db (get-in req [:path-params :id]) :id)]
    (if row
      (respond/ok (admin-detail-view db row))
      (respond/error :notFound "No such booking."))))

;; ---------------------------------------------------------------------------
;; §16 approve

(def approve-schema
  [:map {:closed false}
   [:currency [:re #"^[A-Z]{3}$"]]
   [:lineItems [:sequential [:map {:closed false}
                             [:code :string] [:label :string] [:amount number?]]]]
   [:total number?]
   [:paymentInstructions {:optional true} [:maybe :string]]
   [:addressLine [:string {:min 1 :max 500}]]
   [:mapUrl {:optional true} [:maybe :string]]
   [:checkInInstructions [:string {:min 1 :max 5000}]]
   [:carCollection {:optional true} [:maybe :string]]
   [:hostContact {:optional true} [:maybe :string]]
   [:note {:optional true} [:maybe :string]]
   [:blockDates {:optional true} :boolean]
   [:blockCarDates {:optional true} :boolean]])

(defn- approval-details [body]
  {:currency (:currency body)
   :lineItems (:lineItems body)
   :total (:total body)
   :paymentInstructions (:paymentInstructions body)
   :addressLine (:addressLine body)
   :mapUrl (:mapUrl body)
   :checkInInstructions (:checkInInstructions body)
   :carCollection (:carCollection body)
   :hostContact (:hostContact body)
   :note (:note body)})

(defn- approve [ctx req]
  (let [db (:db ctx)
        id (get-in req [:path-params :id])
        row (get-booking-row db id :id)
        body (mw/validate! approve-schema (:body-params req))]
    (cond
      (nil? row) (respond/error :notFound "No such booking.")
      (not= "pending" (:status row))
      (respond/error :alreadyDecided (str "This booking is already " (:status row) "."))
      :else
      (let [car? (util/->bool (:car_requested row))
            block-dates? (not (false? (:blockDates body)))
            block-car? (not (false? (:blockCarDates body)))
            sum (reduce + 0 (map :amount (:lineItems body)))]
        (when-not (== sum (:total body))
          (respond/throw-error! :validationError "total must equal the sum of lineItems amounts."))
        (when (and car? (str/blank? (:carCollection body)))
          (respond/throw-error! :validationError "carCollection is required when the booking includes the car."))
        (when (and block-dates?
                   (seq (db/q db ["SELECT id FROM availability_blocks
                                   WHERE scope = 'stay' AND source = 'booking'
                                     AND booking_id <> ?
                                     AND start_date < ? AND end_date > ?"
                                  id (:check_out row) (:check_in row)])))
          (respond/throw-error! :dateConflict
                                (str "Nights between " (:check_in row) " and " (:check_out row)
                                     " are already committed to another approved booking."
                                     " Resubmit with blockDates=false to approve anyway.")))
        (let [now (util/now-iso)
              details (approval-details body)]
          (db/tx db
                 (fn [t]
                   (db/exec! t ["UPDATE bookings SET status = 'approved', decision_json = ?,
                                 approval_details_json = ?, updated_at = ? WHERE id = ?"
                                (util/->json {:type "approved" :decidedAt now})
                                (util/->json details) now id])
                   (when block-dates?
                     (add-block! t "stay" id (:reference row) (:check_in row) (:check_out row)
                                 (str "Booking " (:reference row))))
                   (when (and car? block-car? (:car_pick_up row))
                     (add-block! t "car" id (:reference row) (:car_pick_up row) (:car_drop_off row)
                                 (str "Booking " (:reference row) " (car)")))
                   (log-activity! t id (get-in req [:admin-user :name]) "approved" nil)))
          (let [updated (get-booking-row db id :id)]
            (notify/send-email! ctx :bookingApproved (:guest_email row)
                                {:guestFirstName (:guest_first_name row)
                                 :bookingReference (:reference row)
                                 :stayDates (stay-dates-text row)
                                 :priceBreakdown (price-breakdown-text details)
                                 :checkInInstructions (:checkInInstructions body)
                                 :addressLine (:addressLine body)
                                 :hostContact (:hostContact body)
                                 :statusUrl (str "/booking/" (:reference row))})
            (respond/ok (admin-detail-view db updated))))))))

;; ---------------------------------------------------------------------------
;; §17 reject

(def reject-schema
  [:map {:closed false}
   [:explanation [:string {:min 20 :max 1500}]]
   [:internalNote {:optional true} [:maybe [:string {:max 2000}]]]])

(defn- reject [ctx req]
  (let [db (:db ctx)
        id (get-in req [:path-params :id])
        row (get-booking-row db id :id)
        body (mw/validate! reject-schema (:body-params req))]
    (cond
      (nil? row) (respond/error :notFound "No such booking.")
      (not= "pending" (:status row))
      (respond/error :alreadyDecided (str "This booking is already " (:status row) "."))
      :else
      (let [now (util/now-iso)
            decision {:type "rejected" :decidedAt now
                      :explanation (:explanation body)
                      :internalNote (:internalNote body)}]
        (db/tx db (fn [t]
                    (db/exec! t ["UPDATE bookings SET status = 'rejected', decision_json = ?, updated_at = ? WHERE id = ?"
                                 (util/->json decision) now id])
                    (log-activity! t id (get-in req [:admin-user :name]) "rejected" nil)))
        (notify/send-email! ctx :bookingRejected (:guest_email row)
                            {:guestFirstName (:guest_first_name row)
                             :bookingReference (:reference row)
                             :stayDates (stay-dates-text row)
                             :rejectionExplanation (:explanation body)
                             :statusUrl (str "/booking/" (:reference row))})
        (respond/ok (admin-detail-view db (get-booking-row db id :id)))))))

;; ---------------------------------------------------------------------------
;; Routes

(defn routes [ctx]
  [["/bookings"
    {:post {:handler #(create-booking ctx %)
            :middleware [[mw/wrap-rate-limit ctx "POST /bookings"]
                         [mw/wrap-idempotency ctx "POST /bookings"]]}}]
   ["/bookings/:reference" {:get {:handler #(lookup-booking ctx %)}}]
   ["/admin/bookings"
    {:get {:handler #(admin-list ctx %) :middleware [[mw/wrap-admin ctx]]}}]
   ["/admin/bookings/:id"
    {:get {:handler #(admin-get ctx %) :middleware [[mw/wrap-admin ctx]]}}]
   ["/admin/bookings/:id/approve"
    {:post {:handler #(approve ctx %)
            :middleware [[mw/wrap-admin ctx]
                         [mw/wrap-idempotency ctx "POST /admin/bookings/approve"]]}}]
   ["/admin/bookings/:id/reject"
    {:post {:handler #(reject ctx %)
            :middleware [[mw/wrap-admin ctx]
                         [mw/wrap-idempotency ctx "POST /admin/bookings/reject"]]}}]])
