(ns kigali.features.quote
  "§4 POST /quote — stateless price calculation, no persistence."
  (:require [kigali.middleware :as mw]
            [kigali.pricing :as pricing]
            [kigali.respond :as respond]
            [kigali.store :as store]))

(def quote-schema
  [:map {:closed false}
   [:checkIn [:re #"^\d{4}-\d{2}-\d{2}$"]]
   [:checkOut [:re #"^\d{4}-\d{2}-\d{2}$"]]
   [:guests {:optional true} [:int {:min 1}]]
   [:car {:optional true}
    [:map
     [:requested :boolean]
     [:pickUp {:optional true} [:maybe [:re #"^\d{4}-\d{2}-\d{2}$"]]]
     [:dropOff {:optional true} [:maybe [:re #"^\d{4}-\d{2}-\d{2}$"]]]]]])

(defn- post-quote [ctx req]
  (let [db (:db ctx)
        body (mw/validate! quote-schema (:body-params req))
        property (store/property-doc db)
        q (pricing/compute-quote (store/pricing db)
                                 (store/vehicle-doc db)
                                 (:maxGuests property)
                                 body)]
    (respond/ok q)))

(defn routes [ctx]
  [["/quote" {:post {:handler #(post-quote ctx %)}}]])
