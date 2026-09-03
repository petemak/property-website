(ns kigali.middleware
  "Cross-cutting HTTP concerns: error translation, boundary validation,
   admin session auth, idempotency, and per-IP rate limiting."
  (:require [clojure.string :as str]
            [clojure.tools.logging :as log]
            [kigali.db :as db]
            [kigali.respond :as respond]
            [kigali.util :as util]
            [malli.core :as m]
            [malli.error :as me]))

;; ---------------------------------------------------------------------------
;; Errors

(defn wrap-errors
  "Translates thrown contract errors (ex-info with :kk/error) and any
   unexpected exception into the single error shape."
  [handler]
  (fn [req]
    (try
      (handler req)
      (catch clojure.lang.ExceptionInfo e
        (let [d (ex-data e)]
          (if (:kk/error d)
            (respond/error (:code d) (:message d) (get respond/error-status (:code d)))
            (do (log/error e "Unhandled ExceptionInfo" {:uri (:uri req) :data d})
                (respond/error :internalError "Something went wrong on our side.")))))
      (catch Exception e
        (log/error e "Unhandled exception" {:uri (:uri req) :method (:request-method req)})
        (respond/error :internalError "Something went wrong on our side.")))))

;; ---------------------------------------------------------------------------
;; Cache-Control
;;
;; Contract "Caching" bullet + engineering-standards "Performance & delivery":
;; only a small allow-list of read-only GETs is CDN-cacheable. Everything else —
;; every admin route, every mutation, guest-specific reads — defaults to
;; `no-store`. The default is the safe one: a route is cached only by opting in
;; here, never by omission.

(def ^:private cacheable-swr
  "public, max-age=300, stale-while-revalidate=86400")

(defn- static-cacheable-uri? [uri]
  (or (= uri "/api/property")
      (= uri "/api/gallery")
      (= uri "/api/vehicle")
      ;; GET /api/documents/:type/:version
      (some? (re-matches #"/api/documents/[^/]+/[^/]+" uri))))

(defn cache-control-for
  "Pure: the Cache-Control value for a request. GET-only; anything else is
   no-store."
  [{:keys [request-method uri]}]
  (if (not= :get request-method)
    "no-store"
    (cond
      (static-cacheable-uri? uri)              cacheable-swr
      (= uri "/api/availability")              "public, max-age=120"
      (str/starts-with? (str uri) "/api/media/") "public, max-age=31536000, immutable"
      :else                                    "no-store")))

(defn wrap-cache-control
  "Stamps every response with a Cache-Control header derived from the request.
   Runs outermost so it also covers error and default-handler responses."
  [handler]
  (fn [req]
    (let [resp (handler req)]
      (assoc-in resp [:headers "Cache-Control"] (cache-control-for req)))))

;; ---------------------------------------------------------------------------
;; Validation at the API boundary

(defn validate!
  "Returns value when it conforms to schema, else throws a validationError whose
   message names the offending fields in plain language."
  [schema value]
  (if (m/validate schema value)
    value
    (let [errs (-> schema (m/explain value) (me/humanize))
          fields (->> errs
                      (mapcat (fn [[k v]]
                                (if (map? v)
                                  (map #(str (name k) "." (name %)) (keys v))
                                  [(name k)])))
                      distinct
                      sort)]
      (respond/throw-error!
       :validationError
       (str "Please check these fields: " (str/join ", " fields) ".")))))

;; ---------------------------------------------------------------------------
;; Admin session auth

(defn current-user
  "The active admin user for this request, or nil."
  [ctx req]
  (let [cookie-name (get-in ctx [:config :session :cookie-name])
        token (get-in req [:cookies cookie-name :value])]
    (when (and token (not (str/blank? token)))
      (let [row (db/q1 (:db ctx)
                       ["SELECT s.token, s.expires_at, u.id, u.name, u.email, u.role, u.status
                         FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
                         WHERE s.token = ?" token])]
        (when (and row
                   (= "active" (:status row))
                   (pos? (compare (:expires_at row) (util/now-iso))))
          {:id (:id row) :name (:name row) :email (:email row) :role (:role row)})))))

(defn wrap-admin
  "Requires a valid admin session. When require-owner? is true, also requires
   role = owner. Enforced server-side on every protected request."
  ([handler ctx] (wrap-admin handler ctx false))
  ([handler ctx require-owner?]
   (fn [req]
     (if-let [user (current-user ctx req)]
       (if (and require-owner? (not= "owner" (:role user)))
         (respond/error :forbidden "Only the owner can perform this action.")
         (handler (assoc req :admin-user user)))
       (respond/error :unauthorized "Sign in to continue.")))))

;; ---------------------------------------------------------------------------
;; Idempotency

(defn- idem-find [ctx id route]
  (db/q1 (:db ctx)
         ["SELECT request_hash, response_status, response_body FROM idempotency_keys
           WHERE id = ? AND route = ?" id route]))

(defn- idem-save! [ctx id route request-hash status body-str]
  (db/exec! (:db ctx)
            ["INSERT INTO idempotency_keys
              (id, route, request_hash, response_status, response_body, created_at)
              VALUES (?,?,?,?,?,?)"
             id route request-hash status body-str (util/now-iso)]))

(defn wrap-idempotency
  "Enforces the Idempotency-Key contract for the given logical route.
   Missing/invalid key -> 400 idempotencyKeyMissing. Repeat with same body ->
   the stored response + Idempotency-Replayed: true. Same key, different body ->
   409 idempotencyKeyConflict. Only 2xx responses are stored."
  [handler ctx route]
  (fn [req]
    (let [k (get-in req [:headers "idempotency-key"])]
      (if-not (util/uuid-string? k)
        (respond/error :idempotencyKeyMissing
                       "This request requires an Idempotency-Key header (UUID v4).")
        (let [req-hash (util/sha256-hex (util/->json (:body-params req)))
              existing (idem-find ctx k route)]
          (cond
            (and existing (= (:request_hash existing) req-hash))
            (-> (respond/ok (util/<-json (:response_body existing)) (:response_status existing))
                (assoc-in [:headers "Idempotency-Replayed"] "true"))

            existing
            (respond/error :idempotencyKeyConflict
                           "This Idempotency-Key was already used with a different request body.")

            :else
            (let [resp (handler req)]
              (when (<= 200 (:status resp) 299)
                (idem-save! ctx k route req-hash (:status resp) (util/->json (:body resp))))
              resp)))))))

;; ---------------------------------------------------------------------------
;; Rate limiting (per IP + logical route, sliding window, in-memory)

(defonce ^:private buckets (atom {}))

(defn reset-rate-limiter! [] (reset! buckets {}))

(defn- client-ip [req]
  (or (some-> (get-in req [:headers "x-forwarded-for"])
              (str/split #",") first str/trim not-empty)
      (:remote-addr req)
      "unknown"))

(defn wrap-rate-limit
  [handler ctx route]
  (let [{:keys [window-seconds max-requests]} (get-in ctx [:config :ratelimit])
        window-ms (* 1000 window-seconds)]
    (fn [req]
      (let [key [route (client-ip req)]
            now (System/currentTimeMillis)
            cutoff (- now window-ms)
            hits (swap! buckets update key
                        (fn [ts] (conj (filterv #(> % cutoff) (or ts [])) now)))]
        (if (> (count (get hits key)) max-requests)
          (respond/error :rateLimited "Too many requests. Please wait a minute and try again.")
          (handler req))))))
