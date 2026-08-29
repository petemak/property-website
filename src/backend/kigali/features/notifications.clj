(ns kigali.features.notifications
  "§26 email templates + the send helpers invoked by bookings, contact and auth.
   The brand wrapper is applied server-side and is not part of bodyMarkdown."
  (:require [clojure.string :as str]
            [kigali.db :as db]
            [kigali.email :as email]
            [kigali.middleware :as mw]
            [kigali.respond :as respond]
            [kigali.util :as util]))

(def template-keys
  #{"bookingReceived" "bookingApproved" "bookingRejected" "adminNewBooking"
    "contactAck" "adminInvite"})

(def available-tokens
  (into {} (map (fn [k] [k ["guestFirstName" "bookingReference" "stayDates" "priceBreakdown"
                            "checkInInstructions" "addressLine" "hostContact"
                            "rejectionExplanation" "statusUrl"]])
                template-keys)))

;; ---------------------------------------------------------------------------
;; Rendering (pure)

(defn- token-seq [s]
  (map second (re-seq #"\{\{\s*(\w+)\s*\}\}" (or s ""))))

(defn fill [s context]
  (str/replace (or s "") #"\{\{\s*(\w+)\s*\}\}"
               (fn [[_ k]] (str (get context (keyword k) "")))))

(defn- md->html [s]
  (->> (str/split-lines (or s ""))
       (map (fn [line]
              (let [l (-> line
                          (str/replace #"\*\*(.+?)\*\*" "<strong>$1</strong>"))]
                (cond
                  (str/blank? l) ""
                  (str/starts-with? l "## ") (str "<h2>" (subs l 3) "</h2>")
                  (str/starts-with? l "# ") (str "<h1>" (subs l 2) "</h1>")
                  :else (str "<p>" l "</p>")))))
       (str/join "\n")))

(defn brand-wrap [html-body]
  (str "<!doctype html><html><head><meta charset=\"utf-8\"></head>"
       "<body style=\"font-family:Inter,system-ui,sans-serif;color:#2B2A28;background:#FAF7F2;padding:24px\">"
       "<div style=\"max-width:600px;margin:0 auto;background:#fff;padding:24px;border-radius:8px\">"
       "<div style=\"font-family:Fraunces,Georgia,serif;font-size:20px;color:#1F5B4E\">Kigali Keys</div>"
       "<hr style=\"border:none;border-top:1px solid #eee\"/>"
       html-body
       "<hr style=\"border:none;border-top:1px solid #eee\"/>"
       "<div style=\"font-size:12px;color:#888\">Kigali Keys · Rebero, Kigali</div>"
       "</div></body></html>"))

(defn render
  "Returns {:subject :html} for a template row + context."
  [{:keys [subject body_markdown]} context]
  {:subject (fill subject context)
   :html (brand-wrap (md->html (fill body_markdown context)))})

;; ---------------------------------------------------------------------------
;; Send helper (side-effecting; used across slices)

(defn template-row [dbc k]
  (db/q1 dbc ["SELECT template_key, subject, body_markdown FROM email_templates WHERE template_key = ?" k]))

(defn send-email!
  [ctx template-key to context]
  (when-let [tpl (template-row (:db ctx) (name template-key))]
    (let [{:keys [subject html]} (render tpl context)]
      (email/send! (:email ctx)
                   {:to to :template-key template-key :subject subject
                    :body html :context context}))))

;; ---------------------------------------------------------------------------
;; §26 handlers

(defn- require-key! [k]
  (when-not (template-keys k)
    (respond/throw-error! :notFound (str "Unknown template: " k)))
  k)

(defn- row->json [row]
  {:key (:template_key row)
   :subject (:subject row)
   :bodyMarkdown (:body_markdown row)
   :availableTokens (get available-tokens (:template_key row))
   :updatedAt (:updated_at row)})

(defn- list-templates [ctx _req]
  (respond/ok {:templates (mapv row->json
                                (db/q (:db ctx) ["SELECT * FROM email_templates ORDER BY template_key"]))}))

(defn- get-template [ctx req]
  (let [k (require-key! (get-in req [:path-params :key]))
        row (db/q1 (:db ctx) ["SELECT * FROM email_templates WHERE template_key = ?" k])]
    (respond/ok (row->json row))))

(def template-put-schema
  [:map [:subject [:string {:min 1 :max 300}]] [:bodyMarkdown [:string {:min 1 :max 20000}]]])

(defn- put-template [ctx req]
  (let [db (:db ctx)
        k (require-key! (get-in req [:path-params :key]))
        {:keys [subject bodyMarkdown]} (mw/validate! template-put-schema (:body-params req))
        allowed (set (get available-tokens k))
        used (set (concat (token-seq subject) (token-seq bodyMarkdown)))
        unknown (remove allowed used)]
    (when (seq unknown)
      (respond/throw-error! :validationError
                            (str "Unknown template tokens: " (str/join ", " (sort unknown)) ".")))
    (db/exec! db ["UPDATE email_templates SET subject = ?, body_markdown = ?, updated_at = ? WHERE template_key = ?"
                  subject bodyMarkdown (util/now-iso) k])
    (respond/ok (row->json (db/q1 db ["SELECT * FROM email_templates WHERE template_key = ?" k])))))

(defn- preview-template [ctx req]
  (let [db (:db ctx)
        k (require-key! (get-in req [:path-params :key]))
        sample (get-in req [:body-params :sampleContext] {})
        row (db/q1 db ["SELECT * FROM email_templates WHERE template_key = ?" k])]
    (respond/ok (render row sample))))

(defn- test-template [ctx req]
  (let [k (require-key! (get-in req [:path-params :key]))
        to (get-in req [:admin-user :email])]
    (send-email! ctx k to {:guestFirstName (get-in req [:admin-user :name])
                           :bookingReference "KK-DEMO12"
                           :stayDates "5–12 September 2026"
                           :statusUrl "/booking/KK-DEMO12"})
    (respond/accepted {:sent true :to to})))

(defn routes [ctx]
  [["/admin/email-templates"
    {:get {:handler #(list-templates ctx %) :middleware [[mw/wrap-admin ctx]]}}]
   ["/admin/email-templates/:key"
    {:get {:handler #(get-template ctx %) :middleware [[mw/wrap-admin ctx]]}
     :put {:handler #(put-template ctx %) :middleware [[mw/wrap-admin ctx]]}}]
   ["/admin/email-templates/:key/preview"
    {:post {:handler #(preview-template ctx %) :middleware [[mw/wrap-admin ctx]]}}]
   ["/admin/email-templates/:key/test"
    {:post {:handler #(test-template ctx %) :middleware [[mw/wrap-admin ctx]]}}]])
