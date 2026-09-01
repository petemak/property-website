DROP INDEX IF EXISTS idx_sent_emails_template_key;
--;;
DROP INDEX IF EXISTS idx_sent_emails_created_at;
--;;
ALTER TABLE sent_emails DROP COLUMN booking_reference;
--;;
ALTER TABLE sent_emails DROP COLUMN status;
