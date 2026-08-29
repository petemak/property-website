(ns kigali.sanitize
  "Server-side reduction of prose/markdown to a safe subset. We accept Markdown
   text but strip embedded raw HTML, scripts and dangerous URIs so stored
   content can be rendered without XSS risk."
  (:require [clojure.string :as str]))

(def ^:private block-tag-re
  #"(?is)<\s*(script|style|iframe|object|embed|form|link|meta|base)\b[^>]*>.*?<\s*/\s*\1\s*>")

(def ^:private any-tag-re #"(?is)<[^>]+>")
(def ^:private js-uri-re #"(?i)javascript\s*:")
(def ^:private on-attr-re #"(?i)\son\w+\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)")

(defn markdown
  "Removes raw HTML tags, script/style blocks, inline event handlers and
   javascript: URIs. Markdown syntax (#, *, -, [](), etc.) is left intact."
  [s]
  (when s
    (-> s
        (str/replace block-tag-re "")
        (str/replace on-attr-re "")
        (str/replace any-tag-re "")
        (str/replace js-uri-re "")
        str/trim)))

(defn plain
  "For short single-line fields: collapse whitespace and drop any angle brackets."
  [s]
  (when s
    (-> s (str/replace #"[<>]" "") (str/replace #"\s+" " ") str/trim)))
