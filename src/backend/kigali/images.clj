(ns kigali.images
  "Image inspection and thumbnail generation via the JDK's ImageIO — no native
   deps. Used by the backend-proxied gallery upload (never a client-to-bucket
   call)."
  (:require [clojure.java.io :as io]
            [clojure.string :as string])
  (:import [java.awt Image]
           [java.awt.image BufferedImage]
           [javax.imageio ImageIO]))

(def ^:const thumb-max 480)

(defn read-image ^BufferedImage [file]
  (ImageIO/read (io/file file)))

(defn dimensions [^BufferedImage img]
  {:width (.getWidth img) :height (.getHeight img)})

(defn- scaled ^BufferedImage [^BufferedImage src target-w target-h]
  (let [tmp (.getScaledInstance src target-w target-h Image/SCALE_SMOOTH)
        out (BufferedImage. target-w target-h BufferedImage/TYPE_INT_RGB)
        g   (.createGraphics out)]
    (.drawImage g tmp 0 0 nil)
    (.dispose g)
    out))

(defn write-thumbnail!
  "Writes a JPEG thumbnail of src to dest, longest edge <= thumb-max.
   Returns the thumbnail's {:width :height}."
  [src dest]
  (let [img (read-image src)
        w   (.getWidth img)
        h   (.getHeight img)
        ratio (/ (double thumb-max) (double (max w h)))
        tw  (max 1 (int (Math/round (* w (min 1.0 ratio)))))
        th  (max 1 (int (Math/round (* h (min 1.0 ratio)))))
        out (scaled img tw th)]
    (io/make-parents (io/file dest))
    (ImageIO/write out "jpg" (io/file dest))
    {:width tw :height th}))

(defn- ext-format [dest]
  (let [n (string/lower-case (str dest))]
    (cond (string/ends-with? n ".png") "png"
          (string/ends-with? n ".webp") "png"
          :else "jpg")))

(defn write-solid-placeholder!
  "Writes a neutral grey placeholder image. Used only when no real,
   category-matched photo is available."
  [dest w h]
  (let [img (BufferedImage. (int w) (int h) BufferedImage/TYPE_INT_RGB)
        g   (.createGraphics img)]
    (.setColor g (java.awt.Color. 222 218 210))
    (.fillRect g 0 0 (int w) (int h))
    (.dispose g)
    (io/make-parents (io/file dest))
    (ImageIO/write img ^String (ext-format dest) (io/file dest))
    {:width (int w) :height (int h)}))
