(ns kigali.images
  "Image inspection, web-optimisation and thumbnail generation via the JDK's
   ImageIO — no native deps. Used by the backend-proxied gallery upload and by
   the seed / media-export path (never a client-to-bucket call).

   Ingest rule (engineering-standards 'Performance & delivery'): no
   camera-original ever reaches a URL. Every image is downscaled and re-encoded
   to a size budget before it is written anywhere servable."
  (:require [clojure.java.io :as io]
            [clojure.string :as string])
  (:import [java.awt Color RenderingHints]
           [java.awt.image BufferedImage]
           [javax.imageio IIOImage ImageIO ImageWriteParam]
           [javax.imageio.stream FileImageOutputStream]))

;; Long-edge / byte budgets. Mirrors the contract + engineering-standards:
;; full/hero <= ~300 KB at ~2000px, thumbnail <= ~60 KB at ~800px.
(def ^:const full-max-edge 2000)
(def ^:const full-max-bytes 300000)
(def ^:const thumb-max-edge 800)
(def ^:const thumb-max-bytes 60000)

;; Back-compat alias (older callers / tests referenced this name).
(def ^:const thumb-max thumb-max-edge)

(defn read-image ^BufferedImage [file]
  (ImageIO/read (io/file file)))

(defn dimensions [^BufferedImage img]
  {:width (.getWidth img) :height (.getHeight img)})

(defn source-dimensions
  "Reads pixel dimensions from a file header without fully decoding it.
   Returns {:width :height} or nil."
  [file]
  (with-open [iis (ImageIO/createImageInputStream (io/file file))]
    (let [readers (ImageIO/getImageReaders iis)]
      (when (.hasNext readers)
        (let [r (.next readers)]
          (try
            (.setInput r iis)
            {:width (.getWidth r 0) :height (.getHeight r 0)}
            (finally (.dispose r))))))))

(defn scaled-dimensions
  "Target {:width :height} after fitting (w,h) so the long edge is <= max-edge.
   Never upscales. Pure — the single source of truth for the resize geometry."
  [w h max-edge]
  (let [scale (min 1.0 (/ (double max-edge) (double (max w h))))]
    {:width  (max 1 (int (Math/round (* (double w) scale))))
     :height (max 1 (int (Math/round (* (double h) scale))))}))

(defn- draw-into ^BufferedImage [^BufferedImage src tw th]
  (let [out (BufferedImage. (int tw) (int th) BufferedImage/TYPE_INT_RGB)
        g   (.createGraphics out)]
    (.setRenderingHint g RenderingHints/KEY_INTERPOLATION
                       RenderingHints/VALUE_INTERPOLATION_BILINEAR)
    (.setRenderingHint g RenderingHints/KEY_RENDERING
                       RenderingHints/VALUE_RENDER_QUALITY)
    (.setColor g Color/WHITE)
    (.fillRect g 0 0 (int tw) (int th))
    (.drawImage g src 0 0 (int tw) (int th) nil)
    (.dispose g)
    out))

(defn- resize-to-max ^BufferedImage [^BufferedImage img max-edge]
  (let [w (.getWidth img)
        h (.getHeight img)
        {tw :width th :height} (scaled-dimensions w h max-edge)]
    (if (and (= tw w) (= th h))
      (draw-into img w h) ;; flatten to RGB (drop alpha) even when not scaling
      ;; progressive bilinear halving — fast and clean for downscaling
      (loop [cur img cw w ch h]
        (if (and (<= cw (* 2 tw)) (<= ch (* 2 th)))
          (draw-into cur tw th)
          (let [nw (max tw (quot cw 2))
                nh (max th (quot ch 2))]
            (recur (draw-into cur nw nh) nw nh)))))))

(defn- write-jpeg!
  "Writes img to dest as a progressive JPEG at the given quality (0.0–1.0)."
  [^BufferedImage img dest quality]
  (let [writer (.next (ImageIO/getImageWritersByFormatName "jpeg"))
        param  (.getDefaultWriteParam writer)
        dest-f (io/file dest)]
    (.setCompressionMode param ImageWriteParam/MODE_EXPLICIT)
    (.setCompressionQuality param (float quality))
    (.setProgressiveMode param ImageWriteParam/MODE_DEFAULT)
    (io/make-parents dest-f)
    (when (.exists dest-f) (.delete dest-f))
    (with-open [ios (FileImageOutputStream. dest-f)]
      (.setOutput writer ios)
      (try
        (.write writer nil (IIOImage. img nil nil) param)
        (finally (.dispose writer))))))

(def ^:private quality-ladder [0.78 0.68 0.58 0.48])

(defn- encode-within-budget!
  "Encodes img to dest, stepping quality down the ladder until the file is at or
   under max-bytes (or the ladder is exhausted). Returns the final byte size."
  [^BufferedImage img dest max-bytes]
  (loop [[q & more] quality-ladder]
    (write-jpeg! img dest q)
    (let [size (.length (io/file dest))]
      (if (or (<= size max-bytes) (nil? (seq more)))
        size
        (recur more)))))

(defn write-web-image!
  "Re-encodes src into dest as a downscaled progressive JPEG: long edge
   <= max-edge, target size <= max-bytes. Returns {:width :height :bytes}.
   This is the single ingest encoder — seed export and admin upload both go
   through it so no camera-original is ever served."
  ([src dest] (write-web-image! src dest full-max-edge full-max-bytes))
  ([src dest max-edge max-bytes]
   (let [resized (resize-to-max (read-image src) max-edge)
         bytes   (encode-within-budget! resized dest max-bytes)]
     {:width (.getWidth resized) :height (.getHeight resized) :bytes bytes})))

(defn write-thumbnail!
  "Writes a web-optimised JPEG thumbnail of src to dest (long edge
   <= thumb-max-edge, <= ~thumb-max-bytes). Returns {:width :height :bytes}."
  [src dest]
  (write-web-image! src dest thumb-max-edge thumb-max-bytes))

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
