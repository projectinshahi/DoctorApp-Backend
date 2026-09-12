-- The pricing card's fields.
--
-- features and entitlements are kept apart on purpose: the first is the sales
-- copy that appears under the price and gets reworded; the second is what the
-- server checks before unlocking anything. Reading access from the copy would
-- mean renaming a bullet revokes a feature someone paid for.
ALTER TABLE "plans" ADD COLUMN "currency"      TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "plans" ADD COLUMN "features"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "plans" ADD COLUMN "entitlements"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "plans" ADD COLUMN "durationLabel" TEXT;
ALTER TABLE "plans" ADD COLUMN "accentColor"   TEXT;
ALTER TABLE "plans" ADD COLUMN "displayOrder"  INTEGER NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS "plans_courseId_idx";
CREATE INDEX "plans_courseId_isActive_displayOrder_idx"
  ON "plans"("courseId", "isActive", "displayOrder");
