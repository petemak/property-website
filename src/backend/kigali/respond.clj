(ns kigali.respond
  "Response helpers and the single error shape used by every endpoint:
   { \"error\": { \"code\": <machineReadable>, \"message\": <human sentence> } }")

(def error-status
  "Maps every contract error code to its HTTP status."
  {:validationError        422
   :unauthorized           401
   :forbidden              403
   :notFound               404
   :dateConflict           409
   :agreementRequired      422
   :agreementVersionStale  409
   :rateLimited            429
   :idempotencyKeyMissing  400
   :idempotencyKeyConflict 409
   :alreadyDecided         409
   :conflict               409
   :internalError          500})

(defn ok
  ([body] (ok body 200))
  ([body status] {:status status :headers {} :body body}))

(defn created [body] (ok body 201))
(defn accepted [body] (ok body 202))
(defn no-content [] {:status 204 :headers {} :body nil})

(defn error
  "Builds an error response. status is derived from the code unless overridden."
  ([code message] (error code message nil))
  ([code message status]
   {:status (or status (get error-status code 500))
    :headers {}
    :body {:error {:code (name code) :message message}}}))

(defn ex-error
  "An ExceptionInfo carrying a contract error, thrown from deep in a slice and
   turned into the error response by the wrap-errors middleware."
  ([code message] (ex-error code message nil))
  ([code message extra]
   (ex-info message (merge {:kk/error true :code code :message message} extra))))

(defn throw-error!
  ([code message] (throw (ex-error code message)))
  ([code message extra] (throw (ex-error code message extra))))
