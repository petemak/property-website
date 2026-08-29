(ns kigali.router
  "Assembles every feature slice's routes under /api and wraps the handler with
   the shared middleware stack (format negotiation, params, cookies, errors)."
  (:require [kigali.features.agreements :as agreements]
            [kigali.features.auth :as auth]
            [kigali.features.availability :as availability]
            [kigali.features.bookings :as bookings]
            [kigali.features.contact :as contact]
            [kigali.features.content :as content]
            [kigali.features.gallery :as gallery]
            [kigali.features.media :as media]
            [kigali.features.notifications :as notifications]
            [kigali.features.quote :as quote]
            [kigali.features.settings :as settings]
            [kigali.features.vehicle :as vehicle]
            [kigali.middleware :as mw]
            [kigali.respond :as respond]
            [muuntaja.middleware :as muuntaja]
            [reitit.ring :as ring]
            [ring.middleware.cookies :refer [wrap-cookies]]
            [ring.middleware.multipart-params :refer [wrap-multipart-params]]
            [ring.middleware.params :refer [wrap-params]]))

(defn- api-routes [ctx]
  (reduce into
          []
          [(content/routes ctx)
           (gallery/routes ctx)
           (availability/routes ctx)
           (quote/routes ctx)
           (vehicle/routes ctx)
           (bookings/routes ctx)
           (agreements/routes ctx)
           (contact/routes ctx)
           (auth/routes ctx)
           (notifications/routes ctx)
           (settings/routes ctx)
           (media/routes ctx)]))

(defn make-handler [ctx]
  (-> (ring/ring-handler
       (ring/router ["/api" (api-routes ctx)]
                    ;; static segments always win over :path params at match
                    ;; time; the creation-time conflict check is noise here.
                    {:conflicts nil})
       (ring/create-default-handler
        {:not-found (constantly (respond/error :notFound "No such endpoint."))
         :method-not-allowed (constantly (respond/error :notFound "Method not allowed."))
         :not-acceptable (constantly (respond/error :validationError "Not acceptable."))}))
      mw/wrap-errors
      muuntaja/wrap-format
      wrap-multipart-params
      wrap-params
      wrap-cookies))
