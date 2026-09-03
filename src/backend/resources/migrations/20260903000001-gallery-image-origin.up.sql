-- Media URLs (api-contract.md "Media URLs" bullet): a gallery row's URL prefix
-- depends on where the image lives.
--   origin = 'seed'   -> served at rest from the frontend deploy's CDN: /media/...
--   origin = 'upload' -> proxied through the backend (long-cached): /api/media/...
-- Every gallery row that exists today was created by the seeder, so backfill
-- to 'seed'; admin uploads inserted after this migration set 'upload' explicitly.
ALTER TABLE gallery_images ADD COLUMN origin TEXT NOT NULL DEFAULT 'upload'
  CHECK (origin IN ('seed','upload'));
--;;
UPDATE gallery_images SET origin = 'seed';
