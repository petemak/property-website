(ns kigali.main
  (:gen-class)
  (:require [clojure.tools.logging :as log]
            [kigali.system :as system]))

(defn -main [& _]
  (let [sys (system/start!)]
    (.addShutdownHook (Runtime/getRuntime)
                      (Thread. ^Runnable (fn [] (system/stop! sys))))
    (log/info "Kigali Keys API started")
    @(promise)))
