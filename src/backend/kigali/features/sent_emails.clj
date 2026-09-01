(ns kigali.features.sent-emails
  "§26b sent-email log (outbox). Read-only view of every email the system has
   generated. In v1 the transport is 'store & log' — each message is written to
   the sent_emails table with status 'stored' and not transmitted.

   [owner + admin] — guarded with wrap-admin (not owner-only). There are no
   write endpoints: rows appear only as a side effect of the system sending
   mail (see kigali.email/OutboxMailer)."
  (:require [clojure.string :as str]
            [kigali.db :as db]
            [kigali.middleware :as mw]
            [kigali.respond :as respond]))

(def ^:private bare-date-re #"\d{4}-\d{2}-\d{2}")

(defn- parse-pagination [qp]
  (let [page (max 1 (or (parse-long (str (get qp "page" "1"))) 1))
        size (min 100 (max 1 (or (parse-long (str (get qp "pageSize" "20"))) 20)))]
    {:page page :pageSize size :offset (* (dec page) size)}))

(defn- normalize-to
  "A bare calendar date as the upper bound should include the whole day."
  [s]
  (when s
    (if (re-matches bare-date-re s) (str s "T23:59:59Z") s)))

(defn- row->list-item [row]
  {:id (:id row)
   :toAddress (:to_address row)
   :templateKey (:template_key row)
   :subject (:subject row)
   :bookingReference (:booking_reference row)
   :status (:status row)
   :createdAt (:created_at row)})

(defn query-list
  "Pure query logic (no HTTP): filtered, newest-first, paginated. Returns
   {:items :page :pageSize :total}. dbc is anything kigali.db helpers accept.
   opts: {:templateKey :q :from :to :page :pageSize :offset}."
  [dbc {:keys [templateKey q from to page pageSize offset]}]
  (let [template-none? (= templateKey "none")
        template-key   (when (and templateKey (not template-none?)) templateKey)
        clauses (cond-> ["1=1"]
                  template-none? (conj "template_key IS NULL")
                  template-key   (conj "template_key = ?")
                  q           (conj (str "(lower(to_address) LIKE ? "
                                         "OR lower(subject) LIKE ? "
                                         "OR lower(coalesce(booking_reference, '')) LIKE ?)"))
                  from        (conj "created_at >= ?")
                  to          (conj "created_at <= ?"))
        params (cond-> []
                 template-key (conj template-key)
                 q           (into (let [p (str "%" (str/lower-case q) "%")] [p p p]))
                 from        (conj from)
                 to          (conj to))
        where (str/join " AND " clauses)
        total (:c (db/q1 dbc (into [(str "SELECT COUNT(*) AS c FROM sent_emails WHERE " where)]
                                   params)))
        rows (db/q dbc (into [(str "SELECT * FROM sent_emails WHERE " where
                                   " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?")]
                             (concat params [pageSize offset])))]
    {:items (mapv row->list-item rows)
     :page page
     :pageSize pageSize
     :total total}))

(defn- list-sent-emails [ctx req]
  (let [qp (:query-params req)
        {:keys [page pageSize offset]} (parse-pagination qp)]
    (respond/ok
     (query-list (:db ctx)
                 {:templateKey (not-empty (get qp "templateKey"))
                  :q (not-empty (get qp "q"))
                  :from (not-empty (get qp "from"))
                  :to (normalize-to (not-empty (get qp "to")))
                  :page page :pageSize pageSize :offset offset}))))

(defn- get-sent-email [ctx req]
  (let [id (get-in req [:path-params :id])
        row (db/q1 (:db ctx) ["SELECT * FROM sent_emails WHERE id = ?" id])]
    (if-not row
      (respond/error :notFound "No such sent email.")
      (respond/ok {:id (:id row)
                   :toAddress (:to_address row)
                   :templateKey (:template_key row)
                   :bookingReference (:booking_reference row)
                   :subject (:subject row)
                   :html (:body row)
                   :status (:status row)
                   :createdAt (:created_at row)}))))

(defn routes [ctx]
  [["/admin/sent-emails"
    {:get {:handler #(list-sent-emails ctx %) :middleware [[mw/wrap-admin ctx]]}}]
   ["/admin/sent-emails/:id"
    {:get {:handler #(get-sent-email ctx %) :middleware [[mw/wrap-admin ctx]]}}]])
