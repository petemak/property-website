(ns kigali.features.availability
  "§3 public availability, §18 admin blocks, §19 admin pricing."
  (:require [kigali.db :as db]
            [kigali.middleware :as mw]
            [kigali.respond :as respond]
            [kigali.sanitize :as sanitize]
            [kigali.store :as store]
            [kigali.util :as util]))

(def ^:const max-range-days 400)

;; ---------------------------------------------------------------------------
;; Pure helpers

(defn expand-blocks
  "Given block rows {:start_date :end_date} and a window [from,to) as LocalDates,
   returns the sorted distinct set of date strings inside the window that any
   block covers. end_date is exclusive."
  [rows from to]
  (->> rows
       (mapcat (fn [{:keys [start_date end_date]}]
                 (let [s (util/parse-date start_date)
                       e (util/parse-date end_date)]
                   (when (and s e)
                     (util/date-seq (if (.isBefore s from) from s)
                                    (if (.isAfter e to) to e))))))
       distinct
       sort
       vec))

(defn- validate-range! [from to]
  (let [f (util/parse-date from)
        t (util/parse-date to)]
    (when-not (and f t) (respond/throw-error! :validationError "from and to must be valid YYYY-MM-DD dates."))
    (when-not (.isBefore f t) (respond/throw-error! :validationError "to must be after from."))
    (when (> (util/days-between f t) max-range-days)
      (respond/throw-error! :validationError (str "The range cannot exceed " max-range-days " days.")))
    [f t]))

;; ---------------------------------------------------------------------------
;; Queries

(defn blocks-in-range
  [dbc scope from to]
  (db/q dbc ["SELECT * FROM availability_blocks
              WHERE scope = ? AND start_date < ? AND end_date > ?
              ORDER BY start_date"
             scope (util/date-str to) (util/date-str from)]))

(defn approved-booking-overlaps?
  "True if [start,end) overlaps a stay-scope block sourced from a booking."
  [dbc start end]
  (some? (db/q1 dbc ["SELECT id FROM availability_blocks
                      WHERE scope = 'stay' AND source = 'booking'
                        AND start_date < ? AND end_date > ? LIMIT 1"
                     end start])))

;; ---------------------------------------------------------------------------
;; Handlers

(defn- get-availability [ctx req]
  (let [db (:db ctx)
        qp (:query-params req)
        [f t] (validate-range! (get qp "from") (get qp "to"))
        pricing (store/pricing db)]
    (respond/ok
     (merge pricing
            {:rangeStart (util/date-str f)
             :rangeEnd (util/date-str t)
             :unavailableDates (expand-blocks (blocks-in-range db "stay" f t) f t)
             :carUnavailableDates (expand-blocks (blocks-in-range db "car" f t) f t)}))))

(defn- block->json [row]
  (cond-> {:id (:id row)
           :start (:start_date row)
           :end (:end_date row)
           :reason (:reason row)
           :source (:source row)}
    (:booking_reference row) (assoc :bookingReference (:booking_reference row))))

(defn- get-blocks [ctx req]
  (let [db (:db ctx)
        qp (:query-params req)
        [f t] (validate-range! (get qp "from") (get qp "to"))]
    (respond/ok {:blocks (mapv block->json (blocks-in-range db "stay" f t))})))

(def block-create-schema
  [:map
   [:start [:re #"^\d{4}-\d{2}-\d{2}$"]]
   [:end [:re #"^\d{4}-\d{2}-\d{2}$"]]
   [:reason {:optional true} [:maybe [:string {:max 500}]]]])

(defn- post-block [ctx req]
  (let [db (:db ctx)
        {:keys [start end reason]} (mw/validate! block-create-schema (:body-params req))
        s (util/parse-date start)
        e (util/parse-date end)]
    (when-not (.isBefore s e)
      (respond/throw-error! :validationError "end must be after start."))
    (when (approved-booking-overlaps? db start end)
      (respond/throw-error! :dateConflict "Those dates overlap an approved booking."))
    (let [id (util/short-id "blk")]
      (db/exec! db ["INSERT INTO availability_blocks
                     (id, scope, start_date, end_date, reason, source, created_at)
                     VALUES (?,?,?,?,?,?,?)"
                    id "stay" start end (sanitize/plain reason) "manual" (util/now-iso)])
      (respond/created (block->json {:id id :start_date start :end_date end
                                     :reason (sanitize/plain reason) :source "manual"})))))

(defn- delete-block [ctx req]
  (let [db (:db ctx)
        id (get-in req [:path-params :id])
        row (db/q1 db ["SELECT id, source FROM availability_blocks WHERE id = ?" id])]
    (cond
      (nil? row) (respond/error :notFound "No such block.")
      (= "booking" (:source row))
      (respond/error :forbidden "This block comes from a booking. Reject or cancel the booking instead.")
      :else (do (db/exec! db ["DELETE FROM availability_blocks WHERE id = ?" id])
                (respond/no-content)))))

;; ---------------------------------------------------------------------------
;; Pricing (§19)

(def pricing-put-schema
  [:map {:closed false}
   [:nightlyRate [:and number? [:fn {:error/message "must be > 0"} pos?]]]
   [:cleaningFee [:and number? [:fn {:error/message "must be >= 0"} #(>= % 0)]]]
   [:minNights [:int {:min 1 :max 30}]]])

(defn- get-pricing [ctx _req]
  (respond/ok (store/pricing (:db ctx))))

(defn- put-pricing [ctx req]
  (let [db (:db ctx)
        body (mw/validate! pricing-put-schema (:body-params req))
        current (store/pricing db)
        saved (store/put-doc! db "pricing"
                              (merge current (select-keys body [:nightlyRate :cleaningFee :minNights])))]
    (respond/ok saved)))

(defn routes [ctx]
  [["/availability" {:get {:handler #(get-availability ctx %)}}]
   ["/admin/availability/blocks"
    {:get {:handler #(get-blocks ctx %) :middleware [[mw/wrap-admin ctx]]}
     :post {:handler #(post-block ctx %) :middleware [[mw/wrap-admin ctx]]}}]
   ["/admin/availability/blocks/:id"
    {:delete {:handler #(delete-block ctx %) :middleware [[mw/wrap-admin ctx]]}}]
   ["/admin/pricing"
    {:get {:handler #(get-pricing ctx %) :middleware [[mw/wrap-admin ctx]]}
     :put {:handler #(put-pricing ctx %) :middleware [[mw/wrap-admin ctx]]}}]])
