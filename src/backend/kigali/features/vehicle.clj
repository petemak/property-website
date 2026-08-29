(ns kigali.features.vehicle
  "§5 GET /vehicle, §22 admin vehicle details, §23 rental-agreement versions."
  (:require [kigali.middleware :as mw]
            [kigali.respond :as respond]
            [kigali.sanitize :as sanitize]
            [kigali.store :as store]
            [kigali.util :as util]))

(def ^:private agreement-type "vehicleRentalAgreement")

(defn agreement-block [doc]
  (when doc
    {:type agreement-type
     :version (:version doc)
     :effectiveDate (:effectiveDate doc)
     :publishedAt (:publishedAt doc)
     :summaryPoints (:summaryPoints doc)
     :bodyMarkdown (:bodyMarkdown doc)
     :bodyHash (:bodyHash doc)}))

(defn vehicle-response [vehicle agreement-doc]
  (assoc vehicle :agreement (agreement-block agreement-doc)))

(def vehicle-put-schema
  [:map {:closed false}
   [:offered :boolean]
   [:name [:string {:min 1 :max 120}]]
   [:year [:int {:min 1950 :max 2100}]]
   [:bodyType :string]
   [:transmission :string]
   [:seats [:int {:min 1 :max 20}]]
   [:fuel :string]
   [:luggage :string]
   [:dailyRate [:and number? [:fn {:error/message "must be greater than 0"} pos?]]]
   [:description [:string {:max 20000}]]
   [:driverRequirements [:sequential :string]]
   [:covered [:sequential :string]]
   [:notCovered [:sequential :string]]
   [:depositAmount [:and number? [:fn {:error/message "must be >= 0"} #(>= % 0)]]]
   [:geographicLimit :string]
   [:minDriverAge [:int {:min 16 :max 99}]]
   [:minLicenceYears [:int {:min 0 :max 50}]]])

(def agreement-publish-schema
  [:map
   [:bodyMarkdown [:string {:min 200 :max 50000}]]
   [:summaryPoints [:sequential {:min 1} :string]]
   [:effectiveDate [:re #"^\d{4}-\d{2}-\d{2}$"]]])

(defn- get-vehicle [ctx _req]
  (let [db (:db ctx)]
    (respond/ok (vehicle-response (store/vehicle-doc db)
                                  (store/current-doc db agreement-type)))))

(defn- admin-get-vehicle [ctx _req]
  (let [db (:db ctx)
        base (vehicle-response (store/vehicle-doc db) (store/current-doc db agreement-type))
        history (mapv (fn [d]
                        {:version (:version d)
                         :effectiveDate (:effectiveDate d)
                         :publishedAt (:publishedAt d)
                         :publishedBy (:publishedBy d)
                         :acceptanceCount (store/acceptance-count db agreement-type (:version d))
                         :isCurrent (:isCurrent d)})
                      (store/doc-versions db agreement-type))]
    (respond/ok (assoc base :versionHistory history))))

(defn- admin-put-vehicle [ctx req]
  (let [db (:db ctx)
        body (mw/validate! vehicle-put-schema (:body-params req))
        current (store/vehicle-doc db)
        clean (-> body
                  (update :description sanitize/markdown)
                  (assoc :currency (:currency current)
                         :pickUpLocation (:pickUpLocation current)))
        saved (store/put-doc! db "vehicle" clean)]
    (respond/ok (vehicle-response saved (store/current-doc db agreement-type)))))

(defn- admin-agreement-versions [ctx _req]
  (let [db (:db ctx)]
    (respond/ok
     {:versions (mapv (fn [d]
                        {:version (:version d)
                         :effectiveDate (:effectiveDate d)
                         :publishedAt (:publishedAt d)
                         :publishedBy (:publishedBy d)
                         :acceptanceCount (store/acceptance-count db agreement-type (:version d))
                         :isCurrent (:isCurrent d)})
                      (store/doc-versions db agreement-type))})))

(defn- admin-publish-agreement [ctx req]
  (let [db (:db ctx)
        body (mw/validate! agreement-publish-schema (:body-params req))]
    (when (neg? (compare (:effectiveDate body) (str (util/today))))
      (respond/throw-error! :validationError "effectiveDate must be today or later."))
    (let [clean (update body :bodyMarkdown sanitize/markdown)
          published (store/publish-doc! db agreement-type clean (get-in req [:admin-user :name]))]
      (respond/created (select-keys published
                                    [:version :effectiveDate :publishedAt :bodyHash :isCurrent])))))

(defn routes [ctx]
  [["/vehicle" {:get {:handler #(get-vehicle ctx %)}}]
   ["/admin/vehicle"
    {:get {:handler #(admin-get-vehicle ctx %) :middleware [[mw/wrap-admin ctx]]}
     :put {:handler #(admin-put-vehicle ctx %) :middleware [[mw/wrap-admin ctx]]}}]
   ["/admin/vehicle/agreement/versions"
    {:get {:handler #(admin-agreement-versions ctx %) :middleware [[mw/wrap-admin ctx]]}}]
   ["/admin/vehicle/agreement"
    {:post {:handler #(admin-publish-agreement ctx %) :middleware [[mw/wrap-admin ctx]]}}]])
