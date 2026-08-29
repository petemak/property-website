(ns kigali.features.contact
  "§8 POST /contact — question to the host. Rate-limited. Emails the host and
   sends a contactAck to the sender."
  (:require [kigali.email :as email]
            [kigali.features.notifications :as notify]
            [kigali.middleware :as mw]
            [kigali.respond :as respond]
            [kigali.sanitize :as sanitize]
            [kigali.store :as store]
            [kigali.util :as util]))

(def contact-schema
  [:map {:closed false}
   [:name [:string {:min 1 :max 120}]]
   [:email [:fn {:error/message "must be a valid email"} util/email?]]
   [:topic [:enum "bookingQuestion" "theCar" "existingRequest" "other"]]
   [:bookingReference {:optional true} [:maybe [:string {:max 20}]]]
   [:message [:string {:min 1 :max 2000}]]])

(defn- host-notification-body [{:keys [name email topic]} ref message]
  (str "New contact message.\n\n"
       "From: " name " <" email ">\n"
       "Topic: " topic "\n"
       (when ref (str "Booking reference: " ref "\n"))
       "\n" message))

(defn- post-contact [ctx req]
  (let [db (:db ctx)
        body (mw/validate! contact-schema (:body-params req))
        settings (store/settings db)
        message (sanitize/plain (:message body))
        ref (some-> (:bookingReference body) sanitize/plain not-empty)]
    ;; acknowledgement to the sender (managed template)
    (notify/send-email! ctx :contactAck (:email body)
                        {:guestFirstName (:name body)
                         :bookingReference (or ref "")})
    ;; direct notification to the host / notification recipients
    (doseq [host (:newRequestNotificationEmails settings)]
      (email/send! (:email ctx)
                   {:to host
                    :template-key nil
                    :subject (str "Contact form — " (:topic body))
                    :body (host-notification-body body ref message)
                    :context {:topic (:topic body)}}))
    (respond/accepted {:received true})))

(defn routes [ctx]
  [["/contact"
    {:post {:handler #(post-contact ctx %)
            :middleware [[mw/wrap-rate-limit ctx "POST /contact"]]}}]])
