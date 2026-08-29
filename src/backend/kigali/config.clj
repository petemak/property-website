(ns kigali.config
  (:require [aero.core :as aero]
            [clojure.java.io :as io]))

(defn load-config
  "Reads resources/config.edn through aero. All secrets and environment-specific
   values resolve from env vars with dev-only fallbacks."
  ([] (load-config {}))
  ([opts]
   (aero/read-config (io/resource "config.edn") opts)))
