(ns kigali.features.agreements
  "§25 agreement acceptance audit log (read-only) + the acceptance write that is
   a side effect of POST /bookings (§6). There is deliberately no write endpoint."
  (:require [clojure.string :as str]
            [kigali.db :as db]
            [kigali.middleware :as mw]
            [kigali.respond :as respond]
            [kigali.store :as store]
            [kigali.util :as util]))

;; ---------------------------------------------------------------------------
;; Write side-effect (called from the bookings slice)

(defn record-acceptances!
  "Persists one acceptance row per accepted document. Each row captures who /
   when / which version / body hash / IP / user agent and a pointer to the
   immutable document snapshot. Returns the rows as maps."
  [dbc {:keys [booking-id booking-reference accepted-by-name accepted-by-email
               ip-address user-agent accepted-at documents]}]
  (mapv
   (fn [{:keys [type version body-hash snapshot-id]}]
     (let [id (util/short-id "acc")]
       (db/exec! dbc
                 ["INSERT INTO agreement_acceptances
                   (id, booking_id, booking_reference, doc_type, version, body_hash,
                    accepted_by_name, accepted_by_email, accepted_at, ip_address,
                    user_agent, document_snapshot_id)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
                  id booking-id booking-reference type version body-hash
                  accepted-by-name accepted-by-email accepted-at ip-address
                  user-agent snapshot-id])
       {:id id :type type :version version :acceptedAt accepted-at
        :bodyHash body-hash :documentSnapshotId snapshot-id}))
   documents))

(defn acceptances-for-booking [dbc booking-id]
  (db/q dbc ["SELECT * FROM agreement_acceptances WHERE booking_id = ? ORDER BY accepted_at" booking-id]))

(defn row->list-item [row]
  {:id (:id row)
   :bookingReference (:booking_reference row)
   :bookingId (:booking_id row)
   :type (:doc_type row)
   :version (:version row)
   :bodyHash (:body_hash row)
   :acceptedByName (:accepted_by_name row)
   :acceptedByEmail (:accepted_by_email row)
   :acceptedAt (:accepted_at row)
   :ipAddress (:ip_address row)
   :userAgent (:user_agent row)})

;; ---------------------------------------------------------------------------
;; §25 read endpoints

(defn- paginate [req]
  (let [qp (:query-params req)
        page (max 1 (or (parse-long (str (get qp "page" "1"))) 1))
        size (min 100 (max 1 (or (parse-long (str (get qp "pageSize" "20"))) 20)))]
    {:page page :pageSize size :offset (* (dec page) size)}))

(defn- list-acceptances [ctx req]
  (let [db (:db ctx)
        qp (:query-params req)
        {:keys [page pageSize offset]} (paginate req)
        clauses (cond-> ["1=1"]
                  (get qp "type") (conj "doc_type = ?")
                  (get qp "version") (conj "version = ?")
                  (get qp "from") (conj "accepted_at >= ?")
                  (get qp "to") (conj "accepted_at <= ?")
                  (get qp "email") (conj "lower(accepted_by_email) = lower(?)")
                  (get qp "bookingReference") (conj "booking_reference = ?"))
        params (cond-> []
                 (get qp "type") (conj (get qp "type"))
                 (get qp "version") (conj (parse-long (get qp "version")))
                 (get qp "from") (conj (get qp "from"))
                 (get qp "to") (conj (get qp "to"))
                 (get qp "email") (conj (get qp "email"))
                 (get qp "bookingReference") (conj (get qp "bookingReference")))
        where (str/join " AND " clauses)
        total (:c (db/q1 db (into [(str "SELECT COUNT(*) AS c FROM agreement_acceptances WHERE " where)] params)))
        rows (db/q db (into [(str "SELECT * FROM agreement_acceptances WHERE " where
                                  " ORDER BY accepted_at DESC LIMIT ? OFFSET ?")]
                            (concat params [pageSize offset])))]
    (respond/ok {:items (mapv row->list-item rows)
                 :page page :pageSize pageSize :total total})))

(defn- get-acceptance [ctx req]
  (let [db (:db ctx)
        id (get-in req [:path-params :id])
        row (db/q1 db ["SELECT * FROM agreement_acceptances WHERE id = ?" id])]
    (if-not row
      (respond/error :notFound "No such acceptance record.")
      (let [snap (store/doc-version db (:doc_type row) (:version row))]
        (respond/ok
         (assoc (row->list-item row)
                :documentSnapshot
                (when snap
                  {:type (:type snap)
                   :version (:version snap)
                   :effectiveDate (:effectiveDate snap)
                   :bodyMarkdown (:bodyMarkdown snap)
                   :bodyHash (:bodyHash snap)})))))))

(defn routes [ctx]
  [["/admin/agreement-acceptances"
    {:get {:handler #(list-acceptances ctx %) :middleware [[mw/wrap-admin ctx]]}}]
   ["/admin/agreement-acceptances/:id"
    {:get {:handler #(get-acceptance ctx %) :middleware [[mw/wrap-admin ctx]]}}]])
