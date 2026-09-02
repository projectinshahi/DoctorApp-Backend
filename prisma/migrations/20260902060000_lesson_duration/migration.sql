-- Cloudinary already returns this at upload time; it was being returned to the
-- panel and discarded. Nullable because every existing video predates it —
-- those backfill from the first player that reports a duration.
ALTER TABLE "lessons" ADD COLUMN "durationSeconds" INTEGER;
