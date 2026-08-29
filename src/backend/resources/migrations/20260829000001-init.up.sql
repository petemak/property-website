-- Kigali Keys v1 schema.
-- All timestamps are ISO-8601 UTC strings; calendar dates are YYYY-MM-DD.
-- Booleans are stored as INTEGER 0/1. JSON aggregates are stored as TEXT.

CREATE TABLE admin_users (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  email             TEXT NOT NULL UNIQUE,
  password_hash     TEXT,
  role              TEXT NOT NULL CHECK (role IN ('owner','admin')),
  status            TEXT NOT NULL CHECK (status IN ('active','invited','disabled')),
  last_login_at     TEXT,
  invite_token      TEXT,
  invite_expires_at TEXT,
  created_at        TEXT NOT NULL
);
--;;
CREATE TABLE admin_sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES admin_users(id),
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
--;;
CREATE TABLE idempotency_keys (
  id              TEXT NOT NULL,
  route           TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body   TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (id, route)
);
--;;
-- Singleton JSON content documents: property, pricing, vehicle, settings.
CREATE TABLE content_documents (
  doc_key    TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--;;
CREATE TABLE legal_documents (
  id             TEXT PRIMARY KEY,
  doc_type       TEXT NOT NULL CHECK (doc_type IN
                   ('stayTerms','houseRules','websiteTerms','privacy',
                    'cancellationPolicy','vehicleRentalAgreement')),
  version        INTEGER NOT NULL,
  effective_date TEXT NOT NULL,
  body_markdown  TEXT NOT NULL,
  body_hash      TEXT NOT NULL,
  summary_points TEXT NOT NULL DEFAULT '[]',
  published_at   TEXT NOT NULL,
  published_by   TEXT,
  is_current     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (doc_type, version)
);
--;;
CREATE TABLE bookings (
  id                       TEXT PRIMARY KEY,
  reference                TEXT NOT NULL UNIQUE,
  status                   TEXT NOT NULL,
  submitted_at             TEXT NOT NULL,
  guest_first_name         TEXT NOT NULL,
  guest_last_name          TEXT NOT NULL,
  guest_email              TEXT NOT NULL,
  guest_phone              TEXT NOT NULL,
  guest_country            TEXT NOT NULL,
  purpose_of_stay          TEXT NOT NULL,
  check_in                 TEXT NOT NULL,
  check_out                TEXT NOT NULL,
  nights                   INTEGER NOT NULL,
  adults                   INTEGER NOT NULL,
  children                 INTEGER NOT NULL,
  message                  TEXT,
  car_requested            INTEGER NOT NULL DEFAULT 0,
  car_pick_up              TEXT,
  car_drop_off             TEXT,
  car_days                 INTEGER NOT NULL DEFAULT 0,
  driver_full_name         TEXT,
  driver_date_of_birth     TEXT,
  driver_licence_number    TEXT,
  driver_licence_country   TEXT,
  driver_meets_requirements INTEGER,
  estimate_json            TEXT NOT NULL,
  approval_details_json     TEXT,
  decision_json            TEXT,
  status_token             TEXT NOT NULL,
  quote_echo_json          TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);
--;;
CREATE INDEX idx_bookings_status ON bookings(status);
--;;
CREATE INDEX idx_bookings_check_in ON bookings(check_in);
--;;
CREATE TABLE agreement_acceptances (
  id                   TEXT PRIMARY KEY,
  booking_id           TEXT NOT NULL REFERENCES bookings(id),
  booking_reference    TEXT NOT NULL,
  doc_type             TEXT NOT NULL,
  version              INTEGER NOT NULL,
  body_hash            TEXT,
  accepted_by_name     TEXT NOT NULL,
  accepted_by_email    TEXT NOT NULL,
  accepted_at          TEXT NOT NULL,
  ip_address           TEXT,
  user_agent           TEXT,
  document_snapshot_id TEXT NOT NULL
);
--;;
CREATE INDEX idx_acceptances_booking ON agreement_acceptances(booking_id);
--;;
CREATE INDEX idx_acceptances_type ON agreement_acceptances(doc_type);
--;;
CREATE TABLE availability_blocks (
  id                TEXT PRIMARY KEY,
  scope             TEXT NOT NULL CHECK (scope IN ('stay','car')),
  start_date        TEXT NOT NULL,
  end_date          TEXT NOT NULL,               -- exclusive (checkout day)
  reason            TEXT,
  source            TEXT NOT NULL CHECK (source IN ('manual','booking')),
  booking_id        TEXT REFERENCES bookings(id),
  booking_reference TEXT,
  created_at        TEXT NOT NULL
);
--;;
CREATE INDEX idx_blocks_range ON availability_blocks(start_date, end_date);
--;;
CREATE TABLE booking_activity (
  id         TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  at         TEXT NOT NULL,
  actor      TEXT NOT NULL,
  event      TEXT NOT NULL,
  detail     TEXT
);
--;;
CREATE TABLE gallery_images (
  id            TEXT PRIMARY KEY,
  filename      TEXT NOT NULL,
  thumb_filename TEXT NOT NULL,
  alt           TEXT NOT NULL,
  caption       TEXT,
  category      TEXT NOT NULL,
  width         INTEGER NOT NULL,
  height        INTEGER NOT NULL,
  position      INTEGER NOT NULL,
  is_lead       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
--;;
CREATE TABLE email_templates (
  template_key  TEXT PRIMARY KEY,
  subject       TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
--;;
CREATE TABLE sent_emails (
  id           TEXT PRIMARY KEY,
  to_address   TEXT NOT NULL,
  template_key TEXT,
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,
  context_json TEXT,
  created_at   TEXT NOT NULL
);
