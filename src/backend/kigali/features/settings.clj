(ns kigali.features.settings
  "§28 GET/PUT /admin/settings — owner only."
  (:require [kigali.middleware :as mw]
            [kigali.respond :as respond]
            [kigali.sanitize :as sanitize]
            [kigali.store :as store]
            [kigali.util :as util]))

(def settings-put-schema
  [:map {:closed false}
   [:hostDisplayName [:string {:min 1 :max 200}]]
   [:publicEmail [:fn {:error/message "must be a valid email"} util/email?]]
   [:publicPhone [:string {:min 1 :max 40}]]
   [:newRequestNotificationEmails [:sequential [:fn {:error/message "must be a valid email"} util/email?]]]
   [:timezone [:re #"^[A-Za-z]+/[A-Za-z_]+$"]]
   [:currency [:re #"^[A-Z]{3}$"]]
   [:approxLat [:and number? [:fn #(<= -90 % 90)]]]
   [:approxLng [:and number? [:fn #(<= -180 % 180)]]]
   [:revealExactAddressAfterApproval :boolean]
   [:guestResponseTimeText [:string {:max 200}]]])

(defn- get-settings [ctx _req]
  (respond/ok (store/settings (:db ctx))))

(defn- put-settings [ctx req]
  (let [db (:db ctx)
        body (mw/validate! settings-put-schema (:body-params req))
        clean (update body :guestResponseTimeText sanitize/plain)
        saved (store/put-doc! db "settings" clean)]
    (respond/ok saved)))

(defn routes [ctx]
  [["/admin/settings"
    {:get {:handler #(get-settings ctx %) :middleware [[mw/wrap-admin ctx true]]}
     :put {:handler #(put-settings ctx %) :middleware [[mw/wrap-admin ctx true]]}}]])
