(ns kigali.server
  "HTTP server component. Builds the request-handling context from its
   dependencies and serves the reitit ring handler over Jetty."
  (:require [clojure.tools.logging :as log]
            [com.stuartsierra.component :as component]
            [kigali.router :as router]
            [ring.adapter.jetty :as jetty]))

(defrecord WebServer [config db email server]
  component/Lifecycle
  (start [this]
    (if server
      this
      (let [ctx {:config config :db db :email email}
            handler (router/make-handler ctx)
            {:keys [port host]} (:http config)
            srv (jetty/run-jetty handler {:port port :host host :join? false})]
        (log/info "HTTP server listening" {:port port :host host})
        (assoc this :server srv))))
  (stop [this]
    (when server
      (log/info "Stopping HTTP server")
      (.stop server))
    (assoc this :server nil)))

(defn new-server [] (map->WebServer {}))
