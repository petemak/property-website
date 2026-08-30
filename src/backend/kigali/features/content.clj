(ns kigali.features.content
  "Property marketing content (§1, §20) and versioned legal documents
   (§9, §24). Vertical slice: public reads + admin edit/publish."
  (:require [clojure.string :as str]
            [kigali.middleware :as mw]
            [kigali.respond :as respond]
            [kigali.sanitize :as sanitize]
            [kigali.store :as store]
            [kigali.util :as util]))

;; ---------------------------------------------------------------------------
;; Assembly (pure)

(def ^:private placeholder-phone-re
  "Matches obvious non-real numbers used as scaffolding in seed/spec data,
   e.g. '+250 788 000 000' or '+250 7xx xxx xxx'."
  #"(?i)x{2,}|(?<!\d)0{3}(?:\D+0{3})+(?!\d)")

(defn public-phone
  "Owner-editable publicPhone -> the value to expose publicly, or nil when it is
   blank or an obvious placeholder. Pure."
  [s]
  (when (and (string? s)
             (not (str/blank? s))
             (not (re-find placeholder-phone-re s)))
    (str/trim s)))

(defn contact-projection
  "The public `contact` block for GET /property: a projection of the
   owner-editable Settings. `phone` is JSON null when no real public number is
   set (never a placeholder string). Pure."
  [settings]
  {:hostName (:hostDisplayName settings)
   :email (:publicEmail settings)
   :phone (public-phone (:publicPhone settings))
   :responseTimeText (:guestResponseTimeText settings)})

(defn property-response
  "Merges the editable property doc with the managed fields for GET /property."
  [property pricing settings terms-versions updated-at]
  (assoc property
         :pricing (merge pricing
                         {:paymentNote "No payment is taken on this site. The host confirms the final amount and payment method when approving your request."
                          :carNote "The Kia Sorento is USD 45/day, arranged with your booking and paid on site."})
         :termsVersions terms-versions
         :bookingMode "request"
         :contact (contact-projection settings)
         :updatedAt updated-at))

;; ---------------------------------------------------------------------------
;; Validation

(def ^:private amenity-schema
  [:map
   [:key [:string {:min 1 :max 60}]]
   [:label [:string {:min 1 :max 200}]]
   [:category {:optional true} [:maybe :string]]
   [:icon {:optional true} [:maybe :string]]])

(def ^:private poi-schema
  [:map
   [:name [:string {:min 1 :max 200}]]
   [:minutesByCar [:int {:min 0}]]
   [:km {:optional true} [:maybe number?]]
   [:category {:optional true} [:maybe :string]]])

(def property-put-schema
  [:map {:closed false}
   [:name [:string {:min 1 :max 200}]]
   [:tagline [:string {:min 1 :max 300}]]
   [:summary [:string {:min 1 :max 2000}]]
   [:description [:string {:min 1 :max 20000}]]
   [:neighbourhood [:string {:max 300}]]
   [:neighbourhoodText [:string {:max 20000}]]
   [:maxGuests [:int {:min 1 :max 16}]]
   [:bedrooms [:int {:min 0 :max 20}]]
   [:bathrooms [:int {:min 0 :max 20}]]
   [:beds [:sequential [:map [:room :string] [:type :string]]]]
   [:amenities [:sequential amenity-schema]]
   [:included [:sequential :string]]
   [:notIncluded [:sequential :string]]
   [:checkIn [:map
              [:fromTime :string]
              [:untilTime :string]
              [:method :string]
              [:processSteps [:sequential :string]]
              [:publicPreview :string]]]
   [:houseRulesSummary [:sequential :string]]
   [:location [:map
               [:approxLat number?]
               [:approxLng number?]
               [:showExactAddress :boolean]
               [:staticMapUrl {:optional true} [:maybe :string]]
               [:pointsOfInterest [:sequential poi-schema]]]]
   [:arrivalGuide [:string {:max 20000}]]
   [:gettingAroundWithoutCar [:string {:max 20000}]]
   [:faq [:sequential [:map [:question :string] [:answer :string]]]]])

(def doc-publish-schema
  [:map
   [:bodyMarkdown [:string {:min 1 :max 50000}]]
   [:effectiveDate [:re #"^\d{4}-\d{2}-\d{2}$"]]
   [:summaryPoints {:optional true} [:sequential :string]]])

;; ---------------------------------------------------------------------------
;; Sanitising an incoming property doc

(defn sanitize-property [p]
  (-> p
      (update :description sanitize/markdown)
      (update :arrivalGuide sanitize/markdown)
      (update :gettingAroundWithoutCar sanitize/markdown)
      (update :neighbourhoodText sanitize/markdown)
      (update :summary sanitize/plain)
      (update :tagline sanitize/plain)
      (update :name sanitize/plain)
      (update :faq (fn [xs] (mapv #(-> % (update :question sanitize/plain)
                                       (update :answer sanitize/markdown)) xs)))
      (update :amenities #(vec %))
      (update-in [:checkIn :processSteps] #(mapv sanitize/plain %))))

(defn- amenity-keys-unique? [amenities]
  (apply distinct? (or (map :key amenities) [::none])))

;; ---------------------------------------------------------------------------
;; Handlers

(defn- get-property [ctx _req]
  (let [db (:db ctx)]
    (respond/ok (property-response (store/property-doc db)
                                   (store/pricing db)
                                   (store/settings db)
                                   (store/terms-versions db)
                                   (store/doc-updated-at db "property")))))

(defn- admin-get-property [ctx _req]
  (let [db (:db ctx)
        base (property-response (store/property-doc db) (store/pricing db)
                                (store/settings db) (store/terms-versions db)
                                (store/doc-updated-at db "property"))]
    (respond/ok (assoc base :editable true))))

(defn- admin-put-property [ctx req]
  (let [db (:db ctx)
        body (mw/validate! property-put-schema (:body-params req))]
    (when-not (amenity-keys-unique? (:amenities body))
      (respond/throw-error! :validationError "amenities[].key values must be unique."))
    (let [clean (sanitize-property body)
          saved (store/put-doc! db "property" clean)]
      (respond/ok (property-response saved (store/pricing db)
                                    (store/settings db)
                                    (store/terms-versions db)
                                    (store/doc-updated-at db "property"))))))

(defn- parse-version [v]
  (cond
    (= v "current") :current
    (re-matches #"\d+" (str v)) (parse-long (str v))
    :else (respond/throw-error! :validationError "version must be 'current' or an integer.")))

(defn- get-document [ctx req]
  (let [db (:db ctx)
        t (store/require-doc-type! (get-in req [:path-params :type]))
        v (parse-version (get-in req [:path-params :version]))
        doc (if (= v :current) (store/current-doc db t) (store/doc-version db t v))]
    (if doc
      (respond/ok (select-keys doc [:type :version :effectiveDate :isCurrent
                                    :bodyMarkdown :bodyHash :publishedAt]))
      (respond/error :notFound "No such document version."))))

(def ^:private generic-doc-types
  #{"stayTerms" "houseRules" "websiteTerms" "privacy" "cancellationPolicy"})

(defn- admin-doc-versions [ctx req]
  (let [db (:db ctx)
        t (store/require-doc-type! (get-in req [:path-params :type]))]
    (respond/ok
     {:versions (mapv (fn [d]
                        {:version (:version d)
                         :effectiveDate (:effectiveDate d)
                         :publishedAt (:publishedAt d)
                         :publishedBy (:publishedBy d)
                         :acceptanceCount (store/acceptance-count db t (:version d))
                         :isCurrent (:isCurrent d)})
                      (store/doc-versions db t))})))

(defn- admin-publish-doc [ctx req]
  (let [db (:db ctx)
        t (get-in req [:path-params :type])]
    (when-not (generic-doc-types t)
      (respond/throw-error! :validationError
                            "Use POST /admin/vehicle/agreement for the vehicle rental agreement."))
    (let [body (mw/validate! doc-publish-schema (:body-params req))]
      (when (neg? (compare (:effectiveDate body) (str (util/today))))
        (respond/throw-error! :validationError "effectiveDate must be today or later."))
      (let [clean (update body :bodyMarkdown sanitize/markdown)
            actor (get-in req [:admin-user :name])
            published (store/publish-doc! db t clean actor)]
        (respond/created (select-keys published
                                      [:type :version :effectiveDate :isCurrent
                                       :bodyHash :publishedAt]))))))

;; ---------------------------------------------------------------------------
;; Routes

(defn routes [ctx]
  [["/property" {:get {:handler #(get-property ctx %)}}]
   ["/documents/:type/:version" {:get {:handler #(get-document ctx %)}}]
   ["/admin/property"
    {:get {:handler #(admin-get-property ctx %)
           :middleware [[mw/wrap-admin ctx]]}
     :put {:handler #(admin-put-property ctx %)
           :middleware [[mw/wrap-admin ctx]]}}]
   ["/admin/documents/:type/versions"
    {:get {:handler #(admin-doc-versions ctx %)
           :middleware [[mw/wrap-admin ctx]]}}]
   ["/admin/documents/:type"
    {:post {:handler #(admin-publish-doc ctx %)
            :middleware [[mw/wrap-admin ctx]]}}]])
