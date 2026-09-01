(ns kigali.email
  "Email delivery component. All third-party mail delivery is called from the
   backend only. v1 ships a 'store & log' transport (an outbox table the admin
   UI can inspect and 'send test' against); a real SMTP/provider transport slots
   in here behind the same protocol, configured entirely from env vars."
  (:require [clojure.string :as str]
            [clojure.tools.logging :as log]
            [com.stuartsierra.component :as component]
            [kigali.db :as db]
            [kigali.util :as util]))

(defprotocol Mailer
  (-send! [this message]))

(defn send!
  "message: {:to :template-key :subject :body :context}"
  [mailer message]
  (-send! mailer message))

(defrecord OutboxMailer [db]
  component/Lifecycle
  (start [this] this)
  (stop [this] this)

  Mailer
  (-send! [_ {:keys [to template-key subject body context]}]
    (let [id (util/short-id "eml")
          ;; v1 transport is "store & log": every message is written to the
          ;; outbox with status 'stored' and never transmitted. A real provider
          ;; slots in here and would also report queued|sent|delivered|...
          status "stored"
          ;; Booking-scoped emails thread :bookingReference through their context
          ;; map; contactAck / adminInvite carry no reference -> NULL.
          booking-reference (some-> (or (:bookingReference context)
                                        (get context "bookingReference"))
                                    str str/trim not-empty)]
      (db/exec! db
                ["INSERT INTO sent_emails
                  (id, to_address, template_key, subject, body, context_json,
                   status, booking_reference, created_at)
                  VALUES (?,?,?,?,?,?,?,?,?)"
                 id to (some-> template-key name) subject body
                 (util/->json (or context {})) status booking-reference (util/now-iso)])
      (log/info "email stored" {:to to :template template-key :subject subject :status status})
      {:id id :status status :queued true})))

(defn new-mailer [] (map->OutboxMailer {}))
