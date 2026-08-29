(ns kigali.util
  "Small shared helpers: JSON, time, ids, hashing, calendar-date math."
  (:require [jsonista.core :as j])
  (:import [java.security MessageDigest]
           [java.time LocalDate ZoneOffset ZonedDateTime]
           [java.time.format DateTimeFormatter]
           [java.time.temporal ChronoUnit]
           [java.util UUID]))

;; ---------------------------------------------------------------------------
;; JSON

(def mapper
  (j/object-mapper {:encode-key-fn name
                    :decode-key-fn keyword}))

(defn ->json ^String [x] (j/write-value-as-string x mapper))
(defn <-json [s] (when (some? s) (j/read-value s mapper)))

;; ---------------------------------------------------------------------------
;; Time

(defn now-inst ^java.time.Instant [] (.toInstant (ZonedDateTime/now ZoneOffset/UTC)))

(defn now-iso
  "Current UTC timestamp as YYYY-MM-DDTHH:mm:ssZ."
  []
  (.format (ZonedDateTime/now ZoneOffset/UTC)
           (DateTimeFormatter/ofPattern "yyyy-MM-dd'T'HH:mm:ss'Z'")))

(defn plus-hours-iso [hours]
  (.format (.plusHours (ZonedDateTime/now ZoneOffset/UTC) (long hours))
           (DateTimeFormatter/ofPattern "yyyy-MM-dd'T'HH:mm:ss'Z'")))

(defn today ^LocalDate [] (LocalDate/now ZoneOffset/UTC))

;; ---------------------------------------------------------------------------
;; Calendar dates (YYYY-MM-DD)

(defn parse-date
  "Parses YYYY-MM-DD to LocalDate, or nil if invalid."
  ^LocalDate [s]
  (when (string? s)
    (try (LocalDate/parse s) (catch Exception _ nil))))

(defn date-str [^LocalDate d] (str d))

(defn days-between ^long [^LocalDate a ^LocalDate b]
  (.between ChronoUnit/DAYS a b))

(defn date-seq
  "Seq of date strings from start (inclusive) to end (exclusive)."
  [^LocalDate start ^LocalDate end]
  (->> (iterate #(.plusDays ^LocalDate % 1) start)
       (take-while #(.isBefore ^LocalDate % end))
       (mapv str)))

(defn ranges-overlap?
  "Half-open [a-start,a-end) vs [b-start,b-end)."
  [^LocalDate a-start ^LocalDate a-end ^LocalDate b-start ^LocalDate b-end]
  (and (.isBefore a-start b-end) (.isBefore b-start a-end)))

(defn age-years
  "Whole years between a birth date and a reference date."
  ^long [^LocalDate birth ^LocalDate at]
  (.between ChronoUnit/YEARS birth at))

;; ---------------------------------------------------------------------------
;; Ids & hashing

(defn uuid [] (str (UUID/randomUUID)))

(defn uuid-string? [s]
  (and (string? s)
       (try (UUID/fromString s) true (catch Exception _ false))))

(defn sha256-hex [^String s]
  (let [md (MessageDigest/getInstance "SHA-256")
        bs (.digest md (.getBytes s "UTF-8"))]
    (apply str (map #(format "%02x" (bit-and % 0xff)) bs))))

(defn body-hash
  "Canonical content hash used to prove which agreement text was shown."
  [^String body-markdown]
  (str "sha256:" (sha256-hex body-markdown)))

(def ^:private ref-alphabet "ABCDEFGHJKLMNPQRSTUVWXYZ23456789")

(defn booking-reference []
  (str "KK-" (apply str (repeatedly 6 #(rand-nth ref-alphabet)))))

(defn short-id [prefix]
  (str prefix "_" (subs (str (UUID/randomUUID)) 0 8)))

;; ---------------------------------------------------------------------------
;; Field-level predicates (shared by boundary validation)

(defn email? [s]
  (boolean (and (string? s) (re-matches #"[^@\s]+@[^@\s]+\.[^@\s]+" s) (<= (count s) 254))))

(defn alpha2? [s]
  (boolean (and (string? s) (re-matches #"[A-Za-z]{2}" s))))

(defn phone? [s]
  (boolean (and (string? s)
                (re-matches #"\+?[0-9()\-\s]{8,20}" s)
                (>= (count (re-seq #"[0-9]" s)) 8))))

;; ---------------------------------------------------------------------------
;; SQLite boolean coercion

(defn ->bool [v] (cond (nil? v) nil (number? v) (not (zero? v)) :else (boolean v)))
(defn ->bit [v] (if v 1 0))
