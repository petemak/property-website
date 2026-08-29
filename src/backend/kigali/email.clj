(ns kigali.email
  "Email delivery component. All third-party mail delivery is called from the
   backend only. v1 ships a 'store & log' transport (an outbox table the admin
   UI can inspect and 'send test' against); a real SMTP/provider transport slots
   in here behind the same protocol, configured entirely from env vars."
  (:require [clojure.tools.logging :as log]
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
    (let [id (util/short-id "eml")]
      (db/exec! db
                ["INSERT INTO sent_emails
                  (id, to_address, template_key, subject, body, context_json, created_at)
                  VALUES (?,?,?,?,?,?,?)"
                 id to (some-> template-key name) subject body
                 (util/->json (or context {})) (util/now-iso)])
      (log/info "email queued" {:to to :template template-key :subject subject})
      {:id id :queued true})))

(defn new-mailer [] (map->OutboxMailer {}))
