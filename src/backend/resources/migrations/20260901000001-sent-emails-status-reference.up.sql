-- §26b sent-email log (outbox): expose status + booking linkage on stored mail.
-- Existing rows get status 'stored' (v1 transport writes to the outbox, never transmits).
ALTER TABLE sent_emails ADD COLUMN status TEXT NOT NULL DEFAULT 'stored';
--;;
ALTER TABLE sent_emails ADD COLUMN booking_reference TEXT;
--;;
CREATE INDEX idx_sent_emails_created_at ON sent_emails(created_at);
--;;
CREATE INDEX idx_sent_emails_template_key ON sent_emails(template_key);
