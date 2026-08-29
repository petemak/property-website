(ns kigali.test-helpers
  (:require [clojure.string :as str]
            [com.stuartsierra.component :as component]
            [jsonista.core :as j]
            [kigali.config :as config]
            [kigali.db :as db]
            [kigali.email :as email]
            [kigali.middleware :as mw]
            [kigali.router :as router]
            [kigali.seed :as seed])
  (:import [java.io ByteArrayInputStream]
           [java.net URLEncoder]))

(def ^:dynamic *ctx* nil)
(def ^:dynamic *handler* nil)

(def owner-password "test-owner-pass-123")

(defn- tmp-db-url []
  (str "jdbc:sqlite:" (System/getProperty "java.io.tmpdir")
       "/kk-test-" (System/nanoTime) ".db"))

(defn with-system
  "clojure.test fixture: boots db + seed + email against a throwaway SQLite file,
   binds *ctx* and *handler*."
  [f]
  (let [tmp-media (str (System/getProperty "java.io.tmpdir") "/kk-test-media-" (System/nanoTime))
        cfg (-> (config/load-config)
                (assoc-in [:db :jdbc-url] (tmp-db-url))
                (assoc-in [:media :dir] tmp-media)
                (assoc-in [:ratelimit :max-requests] 3)
                (assoc-in [:seed :admin-password] owner-password)
                (assoc-in [:seed :admin-email] "owner@kigalikeys.rw"))
        sys (component/start
             (component/system-map
              :config cfg
              :db (component/using (db/new-db) {:config :config})
              :email (component/using (email/new-mailer) {:db :db})
              :seed (component/using (seed/new-seeder) {:config :config :db :db})))]
    (mw/reset-rate-limiter!)
    (try
      (binding [*ctx* {:config cfg :db (:db sys) :email (:email sys)}
                *handler* (router/make-handler {:config cfg :db (:db sys) :email (:email sys)})]
        (f))
      (finally (component/stop sys)))))

(defn- encode-query [m]
  (when (seq m)
    (->> m
         (map (fn [[k v]] (str (name k) "=" (URLEncoder/encode (str v) "UTF-8"))))
         (interpose "&")
         (apply str))))

(defn request
  "method path & {:keys [body query headers cookie]}
   Returns {:status :body :headers} with body parsed from JSON when present."
  [method path & {:keys [body query headers cookie]}]
  (let [json-body (when (some? body) (j/write-value-as-string body))
        resp (*handler*
              (cond-> {:request-method method
                       :uri path
                       :headers (cond-> (merge {"accept" "application/json"} headers)
                                  (some? body) (assoc "content-type" "application/json")
                                  cookie (assoc "cookie" cookie))
                       :remote-addr "203.0.113.7"}
                query (assoc :query-string (encode-query query))
                json-body (assoc :body (ByteArrayInputStream. (.getBytes ^String json-body "UTF-8")))))
        raw (:body resp)
        s (cond (string? raw) raw (nil? raw) nil :else (slurp raw))]
    {:status (:status resp)
     :headers (:headers resp)
     :body (when (and s (seq s) (re-find #"[\{\[]" s))
             (try (j/read-value s (j/object-mapper {:decode-key-fn keyword}))
                  (catch Exception _ s)))}))

(defn session-cookie
  "Logs in the seeded owner and returns the Set-Cookie value to reuse."
  []
  (let [resp (*handler*
              {:request-method :post :uri "/api/admin/auth/login"
               :headers {"accept" "application/json" "content-type" "application/json"}
               :remote-addr "203.0.113.7"
               :body (ByteArrayInputStream.
                      (.getBytes (j/write-value-as-string
                                  {:email "owner@kigalikeys.rw" :password owner-password})
                                 "UTF-8"))})
        set-cookie (get-in resp [:headers "Set-Cookie"])
        header (if (coll? set-cookie) (first set-cookie) set-cookie)]
    (first (str/split header #";"))))

(defn uuid [] (str (java.util.UUID/randomUUID)))
