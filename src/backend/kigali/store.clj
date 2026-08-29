(ns kigali.store
  "Shared persistence for singleton content documents (property, pricing,
   vehicle, settings) and versioned legal / agreement documents. Feature slices
   build their responses on top of these."
  (:require [kigali.db :as db]
            [kigali.respond :as respond]
            [kigali.util :as util]))

;; ---------------------------------------------------------------------------
;; Singleton content documents

(defn get-doc [dbc k]
  (some-> (db/q1 dbc ["SELECT data FROM content_documents WHERE doc_key = ?" k])
          :data
          util/<-json))

(defn doc-updated-at [dbc k]
  (:updated_at (db/q1 dbc ["SELECT updated_at FROM content_documents WHERE doc_key = ?" k])))

(defn put-doc! [dbc k data]
  (db/exec! dbc ["UPDATE content_documents SET data = ?, updated_at = ? WHERE doc_key = ?"
                 (util/->json data) (util/now-iso) k])
  data)

(defn property-doc [dbc] (get-doc dbc "property"))
(defn pricing [dbc] (get-doc dbc "pricing"))
(defn vehicle-doc [dbc] (get-doc dbc "vehicle"))
(defn settings [dbc] (get-doc dbc "settings"))

;; ---------------------------------------------------------------------------
;; Legal / agreement documents

(def doc-types
  #{"stayTerms" "houseRules" "websiteTerms" "privacy" "cancellationPolicy"
    "vehicleRentalAgreement"})

(defn- row->doc [row]
  (when row
    {:type (:doc_type row)
     :version (:version row)
     :effectiveDate (:effective_date row)
     :isCurrent (util/->bool (:is_current row))
     :bodyMarkdown (:body_markdown row)
     :bodyHash (:body_hash row)
     :summaryPoints (util/<-json (:summary_points row))
     :publishedAt (:published_at row)
     :publishedBy (:published_by row)
     :snapshotId (:id row)}))

(defn current-doc [dbc doc-type]
  (row->doc (db/q1 dbc ["SELECT * FROM legal_documents WHERE doc_type = ? AND is_current = 1" doc-type])))

(defn doc-version [dbc doc-type version]
  (row->doc (db/q1 dbc ["SELECT * FROM legal_documents WHERE doc_type = ? AND version = ?"
                        doc-type version])))

(defn doc-versions [dbc doc-type]
  (mapv row->doc
        (db/q dbc ["SELECT * FROM legal_documents WHERE doc_type = ? ORDER BY version DESC" doc-type])))

(defn acceptance-count [dbc doc-type version]
  (:c (db/q1 dbc ["SELECT COUNT(*) AS c FROM agreement_acceptances WHERE doc_type = ? AND version = ?"
                  doc-type version])))

(defn terms-versions
  "The termsVersions block for GET /property."
  [dbc]
  {:stayTerms (:version (current-doc dbc "stayTerms"))
   :houseRules (:version (current-doc dbc "houseRules"))})

(defn publish-doc!
  "Creates a new immutable version and makes it current. Prior versions and the
   acceptances that reference them are untouched."
  [dbc doc-type {:keys [bodyMarkdown effectiveDate summaryPoints]} published-by]
  (db/tx
   dbc
   (fn [t]
     (let [next-v (-> (db/q1 t ["SELECT COALESCE(MAX(version),0) AS v FROM legal_documents WHERE doc_type = ?" doc-type])
                      :v long inc)
           id (util/short-id "doc")
           now (util/now-iso)]
       (db/exec! t ["UPDATE legal_documents SET is_current = 0 WHERE doc_type = ?" doc-type])
       (db/exec! t ["INSERT INTO legal_documents
                     (id, doc_type, version, effective_date, body_markdown, body_hash,
                      summary_points, published_at, published_by, is_current)
                     VALUES (?,?,?,?,?,?,?,?,?,1)"
                    id doc-type next-v effectiveDate bodyMarkdown
                    (util/body-hash bodyMarkdown)
                    (util/->json (or summaryPoints []))
                    now published-by])
       (row->doc (db/q1 t ["SELECT * FROM legal_documents WHERE id = ?" id]))))))

(defn require-doc-type! [t]
  (when-not (doc-types t)
    (respond/throw-error! :notFound (str "Unknown document type: " t)))
  t)
