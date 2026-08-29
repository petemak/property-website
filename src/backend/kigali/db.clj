(ns kigali.db
  "Database component (HikariCP pool over SQLite) plus thin query helpers.
   Migrations run on component start via migratus."
  (:require [clojure.tools.logging :as log]
            [com.stuartsierra.component :as component]
            [hikari-cp.core :as hikari]
            [migratus.core :as migratus]
            [next.jdbc :as jdbc]
            [next.jdbc.result-set :as rs]))

(def ^:private jdbc-opts
  {:builder-fn rs/as-unqualified-lower-maps})

(defn migratus-config [datasource]
  {:store :database
   :migration-dir "migrations"
   :db {:datasource datasource}})

(defrecord Db [config datasource]
  component/Lifecycle
  (start [this]
    (if datasource
      this
      (let [jdbc-url (get-in config [:db :jdbc-url])
            pool-size (get-in config [:db :pool-size] 1)
            ds (hikari/make-datasource
                {:jdbc-url jdbc-url
                 :maximum-pool-size pool-size
                 :minimum-idle (min 1 pool-size)
                 :pool-name "kigali-keys"})]
        (log/info "Starting DB pool" {:jdbc-url jdbc-url :pool-size pool-size})
        ;; SQLite: enforce FK constraints per connection is not pool-wide;
        ;; run pragma on the shared datasource once at boot.
        (jdbc/execute! ds ["PRAGMA foreign_keys = ON"])
        (log/info "Running migrations")
        (migratus/migrate (migratus-config ds))
        (assoc this :datasource ds))))
  (stop [this]
    (when datasource
      (log/info "Stopping DB pool")
      (hikari/close-datasource datasource))
    (assoc this :datasource nil)))

(defn new-db [] (map->Db {}))

;; ---------------------------------------------------------------------------
;; Query helpers — every callsite passes the Db component (or its datasource).

(defn ds
  "Resolves a runnable JDBC source from either the Db component, a raw
   datasource/connection, or a transaction connection."
  [db]
  (cond
    (instance? Db db) (:datasource db)
    (map? db)         (:datasource db)
    :else             db))

(defn q
  "Returns a vector of unqualified-lower-keyword maps."
  [db sqlvec]
  (jdbc/execute! (ds db) sqlvec jdbc-opts))

(defn q1
  "Returns the first row or nil."
  [db sqlvec]
  (jdbc/execute-one! (ds db) sqlvec jdbc-opts))

(defn exec!
  "Runs a statement, returns the update-count map."
  [db sqlvec]
  (jdbc/execute-one! (ds db) sqlvec))

(defn tx
  "Runs (f tx-source) inside a transaction. tx-source is accepted by q/q1/exec!."
  [db f]
  (jdbc/with-transaction [conn (ds db)]
    (f {:datasource conn})))
