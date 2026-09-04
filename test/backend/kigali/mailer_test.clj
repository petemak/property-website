(ns kigali.mailer-test
  "SMTP transport: outbox recording is shared, SMTP sends off-thread and records
   sent/failed without ever throwing, and system wiring selects the transport
   from MAIL_TRANSPORT."
  (:require [clojure.test :refer [deftest is testing use-fixtures]]
            [com.stuartsierra.component :as component]
            [kigali.db :as db]
            [kigali.email :as email]
            [kigali.test-helpers :as h :refer [request]]))

(use-fixtures :each h/with-system)

(def ^:private msg
  {:to "guest@example.com"
   :template-key :bookingApproved
   :subject "Your Kigali Keys stay is confirmed — KK-DEMO12"
   :body "<!doctype html><html><body><p>Hi Lena</p></body></html>"
   :context {:bookingReference "KK-DEMO12"}})

(defn- row [id]
  (db/q1 (:db h/*ctx*) ["SELECT id, to_address, template_key, subject, status, booking_reference
                         FROM sent_emails WHERE id = ?" id]))

(defn- start-smtp [sender]
  (component/start
   (email/map->SmtpMailer {:db (:db h/*ctx*) :config (:config h/*ctx*) :sender sender})))

;; ---------------------------------------------------------------------------
;; Shared outbox recording

(deftest outbox-still-records-stored
  (let [{:keys [id status]} (email/send! (:email h/*ctx*) msg)]
    (is (= "stored" status))
    (let [r (row id)]
      (is (= "stored" (:status r)))
      (is (= "guest@example.com" (:to_address r)))
      (is (= "bookingApproved" (:template_key r)))
      (is (= "KK-DEMO12" (:booking_reference r))))))

;; ---------------------------------------------------------------------------
;; SmtpMailer — stubbed send-fn, never hits the network

(deftest smtp-success-records-sent
  (let [sent (atom nil)
        m (start-smtp (fn [x] (reset! sent x) {:error :SUCCESS}))]
    (try
      (let [ret (email/send! m msg)
            final (email/await-result ret 5000)]
        (is (= "sent" (:status final)))
        (is (= "sent" (:status (row (:id ret)))))
        (is (= "guest@example.com" (:to @sent))))
      (finally (component/stop m)))))

(deftest smtp-failure-records-failed-and-does-not-throw
  (let [m (start-smtp (fn [_] (throw (ex-info "Connection refused" {}))))]
    (try
      (let [ret (email/send! m msg)
            final (email/await-result ret 5000)]
        (is (= "failed" (:status final)))
        (is (string? (:error final)))
        (is (= "failed" (:status (row (:id ret))))))
      (finally (component/stop m)))))

(deftest html-to-text-alternative
  (is (= "Hi Lena\nSee you soon"
         (email/html->text "<p>Hi Lena</p><p>See you soon</p>"))))

;; ---------------------------------------------------------------------------
;; Transport selection

(deftest mailer-for-config-selection
  (let [cfg (:config h/*ctx*)
        smtp-full {:host "smtp.zoho.com" :port 465 :user "u@kigalikeys.rw"
                   :pass "secret" :from "u@kigalikeys.rw" :ssl? true}]
    (testing "unset / outbox -> OutboxMailer"
      (is (instance? kigali.email.OutboxMailer
                     (email/mailer-for-config (assoc cfg :mail {:transport "outbox"}))))
      (is (instance? kigali.email.OutboxMailer
                     (email/mailer-for-config (dissoc cfg :mail)))))
    (testing "smtp + full config -> SmtpMailer"
      (is (instance? kigali.email.SmtpMailer
                     (email/mailer-for-config
                      (assoc cfg :mail {:transport "smtp" :smtp smtp-full})))))
    (testing "smtp + missing SMTP_HOST -> startup error"
      (is (thrown-with-msg?
           clojure.lang.ExceptionInfo #"missing SMTP config"
           (email/mailer-for-config
            (assoc cfg :mail {:transport "smtp" :smtp (dissoc smtp-full :host)})))))))

;; ---------------------------------------------------------------------------
;; §26b GET still works, §26 test endpoint returns a concrete status

(deftest sent-emails-log-unaffected
  (let [c (h/session-cookie)
        _ (email/send! (:email h/*ctx*) msg)
        r (request :get "/api/admin/sent-emails" :cookie c)]
    (is (= 200 (:status r)))
    (is (some #(= "KK-DEMO12" (:bookingReference %)) (get-in r [:body :items])))))

(deftest test-endpoint-reports-status
  (let [c (h/session-cookie)
        r (request :post "/api/admin/email-templates/bookingApproved/test" :cookie c)]
    (is (= 200 (:status r)))
    (is (= "stored" (get-in r [:body :status])))
    (is (true? (get-in r [:body :sent])))))
