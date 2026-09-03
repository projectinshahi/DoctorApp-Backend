-- Backfilled to createdAt so existing sessions are not all treated as ancient
-- the moment this ships, which would let anyone take over any account once.
ALTER TABLE "sessions" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
UPDATE "sessions" SET "lastSeenAt" = "createdAt" WHERE "revokedAt" IS NULL;
