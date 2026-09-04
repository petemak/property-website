(ns kigali.email
  "Email delivery component. All third-party mail delivery is called from the
   backend only.

   Two transports sit behind the same `Mailer` protocol, selected by
   `MAIL_TRANSPORT`:

   - `outbox` (default) — 'store & log': every message is written to the
     `sent_emails` table with status `\"stored\"` and never transmitted. This is
     what staging runs on.
   - `smtp` — actually transmits via SMTP (postal / JavaMail), then records the
     message with status `\"sent\"` or `\"failed\"`. Sending is off the request
     thread (bounded single-thread executor) so a slow or dead SMTP server can
     never hang a guest request."
  (:require [clojure.string :as str]
            [clojure.tools.logging :as log]
            [com.stuartsierra.component :as component]
            [postal.core :as postal]
            [kigali.db :as db]
            [kigali.util :as util])
  (:import [java.util.concurrent Callable Executors ExecutorService TimeUnit]))

(defprotocol Mailer
  (-send! [this message]))

(defn send!
  "message: {:to :template-key :subject :body :context}
   Returns a map with at least {:id :status}. When the transport sends
   asynchronously the map also carries {:async true :result <future>} — deref the
   future for the final {:id :status :error?}. Use `await-result` to normalise."
  [mailer message]
  (-send! mailer message))

(defn await-result
  "Given the return of `send!`, block (up to timeout-ms) for a concrete
   {:id :status :error?} map. Synchronous transports return immediately."
  [ret timeout-ms]
  (if-let [fut (:result ret)]
    (deref fut timeout-ms {:id (:id ret) :status "failed" :error "send timed out"})
    ret))

;; ---------------------------------------------------------------------------
;; Shared outbox recording

(defn- record-sent!
  "Writes one row to `sent_emails` and returns {:id :status}. `status` is the
   transport-reported state: \"stored\" (outbox), \"sent\" or \"failed\" (smtp)."
  [db id {:keys [to template-key subject body context]} status]
  (let [;; Booking-scoped emails thread :bookingReference through their context
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
    {:id id :status status}))

;; ---------------------------------------------------------------------------
;; Outbox transport (default) — store & log, never transmits

(defrecord OutboxMailer [db]
  component/Lifecycle
  (start [this] this)
  (stop [this] this)

  Mailer
  (-send! [_ message]
    (let [id (util/short-id "eml")
          {:keys [status] :as result} (record-sent! db id message "stored")]
      (log/info "email stored"
                {:to (:to message) :template (:template-key message)
                 :subject (:subject message) :status status})
      result)))

(defn new-mailer [] (map->OutboxMailer {}))

;; ---------------------------------------------------------------------------
;; SMTP transport — transmits, then records "sent"/"failed"

(defn html->text
  "Crude text/plain alternative: drop tags, keep block breaks. Not pretty, just
   a non-empty plain part for clients that prefer it."
  [html]
  (-> (or html "")
      (str/replace #"(?i)<\s*br\s*/?>" "\n")
      (str/replace #"(?i)</\s*(?:p|div|h[1-6]|li|tr|table)\s*>" "\n")
      (str/replace #"<[^>]+>" "")
      (str/replace #"(?m)[ \t]+" " ")
      (str/replace #"\n{3,}" "\n\n")
      str/trim))

(defn- smtp-send!
  "Transmits one message via SMTP. Throws on any failure."
  [{:keys [host port user pass from reply-to ssl?]} {:keys [to subject body]}]
  (let [conn (cond-> {:host host
                      :port (or port (if ssl? 465 25))
                      :user user
                      :pass pass
                      ;; tight JavaMail timeouts (values must be strings)
                      :connectiontimeout "7000"
                      :timeout "7000"
                      :writetimeout "7000"}
               ssl? (assoc :ssl true))
        msg (cond-> {:from from
                     :to to
                     :subject (or subject "")
                     :body [:alternative
                            {:type "text/plain; charset=utf-8" :content (html->text body)}
                            {:type "text/html; charset=utf-8" :content (or body "")}]}
              (not (str/blank? (str reply-to))) (assoc :reply-to reply-to))
        result (postal/send-message conn msg)]
    (when-not (= :SUCCESS (:error result))
      (throw (ex-info "SMTP send failed" {:postal result})))
    result))

(defrecord SmtpMailer [db config sender executor]
  component/Lifecycle
  (start [this]
    (if executor
      this
      (assoc this :executor (Executors/newSingleThreadExecutor))))
  (stop [this]
    (when executor
      (.shutdown ^ExecutorService executor)
      (when-not (.awaitTermination ^ExecutorService executor 10 TimeUnit/SECONDS)
        (.shutdownNow ^ExecutorService executor)))
    (assoc this :executor nil))

  Mailer
  (-send! [_ message]
    (let [id (util/short-id "eml")
          smtp (get-in config [:mail :smtp])
          send-fn (or sender #(smtp-send! smtp %))
          task (fn []
                 (try
                   (send-fn message)
                   (record-sent! db id message "sent")
                   (catch Throwable e
                     (log/warn "email send failed"
                               {:to (:to message)
                                :template (some-> (:template-key message) name)
                                :error (ex-message e)})
                     (assoc (record-sent! db id message "failed")
                            :error (ex-message e)))))
          fut (.submit ^ExecutorService executor ^Callable task)]
      {:id id :status "pending" :async true :result fut})))

(defn- missing-smtp-keys [smtp]
  (for [k [:host :user :pass :from]
        :when (str/blank? (str (get smtp k)))]
    k))

(defn mailer-for-config
  "Selects the mailer from (get-in config [:mail :transport]). \"smtp\" builds an
   SmtpMailer (failing fast if required SMTP_* vars are absent); anything else
   builds the store-&-log OutboxMailer."
  [config]
  (if (= "smtp" (get-in config [:mail :transport]))
    (let [missing (missing-smtp-keys (get-in config [:mail :smtp]))]
      (when (seq missing)
        (throw (ex-info (str "MAIL_TRANSPORT=smtp but missing SMTP config: "
                             (str/join ", " (map name missing))
                             ". Set SMTP_HOST / SMTP_USER / SMTP_PASS / SMTP_FROM.")
                        {:missing (vec missing)})))
      (map->SmtpMailer {}))
    (map->OutboxMailer {})))
