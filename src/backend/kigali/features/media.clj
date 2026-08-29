(ns kigali.features.media
  "§10 GET /media/... — backend-served static assets (gallery images,
   thumbnails, static map images). Plain cacheable HTTP, no JSON."
  (:require [clojure.java.io :as io]
            [clojure.string :as str]
            [kigali.respond :as respond]
            [ring.util.mime-type :as mime]))

(defn- safe-path? [p]
  (and p (not (str/includes? p "..")) (not (str/starts-with? p "/"))))

(defn- serve [ctx req]
  (let [root (get-in ctx [:config :media :dir])
        rel (get-in req [:path-params :path])]
    (if-not (safe-path? rel)
      (respond/error :notFound "Not found.")
      (let [f (io/file root rel)]
        (if (and (.exists f) (.isFile f))
          {:status 200
           :headers {"Content-Type" (or (mime/ext-mime-type (.getName f)) "application/octet-stream")
                     "Cache-Control" "public, max-age=300"}
           :body f}
          (respond/error :notFound "Not found."))))))

(defn routes [ctx]
  [["/media/*path" {:get {:handler #(serve ctx %)}}]])
