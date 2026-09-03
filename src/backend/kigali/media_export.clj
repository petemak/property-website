(ns kigali.media-export
  "Exports the 25 seed gallery images + the approximate-location map as
   web-optimised files for the frontend to bundle into its deploy.

   api-contract.md 'Media URLs': seed image URLs are CDN-relative (/media/...)
   and are served at rest from the frontend deploy, never proxied through the
   backend. This is the mechanism that produces those files. It re-encodes from
   assets/property-photos/ using the exact same encoder the backend seeder uses
   (kigali.images/write-web-image!), so the bytes match what GET /gallery
   describes.

   Usage:
     clojure -X:export-media
     clojure -X:export-media :photos-dir '\"assets/property-photos\"' :out-dir '\"src/frontend/public/media\"'

   Output layout (mirrors the /media/ URL space):
     <out-dir>/gallery/<basename>.jpg        full image  (<= ~300 KB, <= 2000px)
     <out-dir>/gallery/<stem>_thumb.jpg      thumbnail   (<= ~60 KB,  <= 800px)
     <out-dir>/map/approx.jpg                static map (re-encoded from .png)
   The exact-location map is never exported."
  (:require [clojure.java.io :as io]
            [clojure.string :as str]
            [kigali.images :as images]
            [kigali.seed :as seed]))

(defn- basename [rel] (last (str/split rel #"/")))
(defn- stem [name] (str/replace name #"\.[^.]+$" ""))
(defn- kb [n] (format "%.0f KB" (/ (double n) 1024.0)))

(defn export!
  [{:keys [photos-dir out-dir]
    :or   {photos-dir "assets/property-photos"
           out-dir    "src/frontend/public/media"}}]
  (let [gallery-out (io/file out-dir "gallery")
        rows        (atom [])]
    (io/make-parents (io/file gallery-out "x"))
    (doseq [[category rel _alt _caption] seed/gallery-seed]
      (let [src   (io/file photos-dir rel)
            base  (basename rel)
            fname (str (stem base) ".jpg")
            tname (str (stem base) "_thumb.jpg")
            full  (io/file gallery-out fname)
            thumb (io/file gallery-out tname)]
        (if (.exists src)
          (let [before (.length src)
                {fw :width fh :height fb :bytes} (images/write-web-image! src full)
                {tw :width th :height tb :bytes} (images/write-thumbnail! src thumb)]
            (swap! rows conj {:category category :file fname
                              :before before :full fb :thumb tb
                              :dims (str fw "x" fh) :tdims (str tw "x" th)})
            (println (format "  %-20s %-28s %9s -> full %8s (%s)  thumb %7s (%s)"
                             category fname (kb before) (kb fb) (str fw "x" fh)
                             (kb tb) (str tw "x" th))))
          (println (format "  !! MISSING SOURCE, SKIPPED: %s (%s)" rel category)))))
    ;; approximate-location map only
    (let [map-src (io/file photos-dir "location-map/approximate-location.png")
          map-out (io/file out-dir "map" "approx.jpg")]
      (io/make-parents map-out)
      (if (.exists map-src)
        (let [{:keys [width height bytes]} (images/write-web-image! map-src map-out 1200 120000)]
          (println (format "  %-20s %-28s %9s -> %8s (%s)"
                           "Location map" "map/approx.jpg" (kb (.length map-src))
                           (kb bytes) (str width "x" height))))
        (println "  !! MISSING map source, skipped")))
    (let [rs @rows
          over-full  (filter #(> (:full %) images/full-max-bytes) rs)
          over-thumb (filter #(> (:thumb %) images/thumb-max-bytes) rs)]
      (println)
      (println (format "Exported %d gallery images + map to %s" (count rs) out-dir))
      (when (seq over-full)
        (println "WARNING: over full budget:" (mapv :file over-full)))
      (when (seq over-thumb)
        (println "WARNING: over thumb budget:" (mapv :file over-thumb))))))

(defn -main [& args]
  (export! (apply hash-map (map read-string args)))
  (shutdown-agents))
