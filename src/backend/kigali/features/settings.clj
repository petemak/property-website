(ns kigali.features.settings
  "§28 GET/PUT /admin/settings — owner only."
  (:require [clojure.string :as str]
            [kigali.middleware :as mw]
            [kigali.respond :as respond]
            [kigali.sanitize :as sanitize]
            [kigali.store :as store]
            [kigali.util :as util]))

(def settings-put-schema
  [:map {:closed false}
   [:hostDisplayName [:string {:min 1 :max 200}]]
   [:publicEmail [:fn {:error/message "must be a valid email"} util/email?]]
   ;; publicPhone is optional and nullable: the host may run email-only, and a
   ;; number that was set must be clearable back to null. A frontend that clears
   ;; the field may send "" rather than null, so the lower bound is 0 rather than
   ;; :min 1; blank/whitespace-only strings are coerced to nil in `normalize`
   ;; before they reach the store.
   [:publicPhone {:optional true} [:maybe [:string {:max 40}]]]
   [:newRequestNotificationEmails [:sequential [:fn {:error/message "must be a valid email"} util/email?]]]
   [:timezone [:re #"^[A-Za-z]+/[A-Za-z_]+$"]]
   [:currency [:re #"^[A-Z]{3}$"]]
   [:approxLat [:and number? [:fn #(<= -90 % 90)]]]
   [:approxLng [:and number? [:fn #(<= -180 % 180)]]]
   [:revealExactAddressAfterApproval :boolean]
   ;; guestResponseTimeText is optional and nullable for the same reason as
   ;; publicPhone: the frontend sends null (or "") when the owner clears it.
   ;; Blank values are collapsed to nil in `normalize`.
   [:guestResponseTimeText {:optional true} [:maybe [:string {:max 200}]]]])

(defn blank->nil
  "Trim a string; nil when it is blank, whitespace-only, or not a string. Pure."
  [s]
  (when (string? s)
    (let [t (str/trim s)]
      (when-not (str/blank? t) t))))

(defn normalize
  "Business-logic normalisation of an incoming settings doc. An omitted, null,
   empty or whitespace-only `publicPhone` / `guestResponseTimeText` is stored as
   nil; other values are stored trimmed. Keeps GET /admin/settings and GET
   /property's contact projection returning null rather than \"\". Pure."
  [settings]
  (-> settings
      (assoc :publicPhone (blank->nil (:publicPhone settings)))
      (assoc :guestResponseTimeText (blank->nil (:guestResponseTimeText settings)))))

(defn- get-settings [ctx _req]
  (respond/ok (store/settings (:db ctx))))

(defn- put-settings [ctx req]
  (let [db (:db ctx)
        body (mw/validate! settings-put-schema (:body-params req))
        clean (-> body
                  (update :guestResponseTimeText sanitize/plain)
                  normalize)
        saved (store/put-doc! db "settings" clean)]
    (respond/ok saved)))

(defn routes [ctx]
  [["/admin/settings"
    {:get {:handler #(get-settings ctx %) :middleware [[mw/wrap-admin ctx true]]}
     :put {:handler #(put-settings ctx %) :middleware [[mw/wrap-admin ctx true]]}}]])
