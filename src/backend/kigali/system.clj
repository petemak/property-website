(ns kigali.system
  (:require [com.stuartsierra.component :as component]
            [kigali.config :as config]
            [kigali.db :as db]
            [kigali.email :as email]
            [kigali.seed :as seed]
            [kigali.server :as server]))

(defn new-system
  ([] (new-system (config/load-config)))
  ([cfg]
   (component/system-map
    :config cfg
    :db     (component/using (db/new-db) {:config :config})
    :email  (component/using (email/mailer-for-config cfg) {:db :db :config :config})
    :seed   (component/using (seed/new-seeder) {:config :config :db :db})
    :server (component/using (server/new-server)
                             {:config :config :db :db :email :email}))))

(defn start! [] (component/start (new-system)))
(defn stop! [sys] (component/stop sys))
