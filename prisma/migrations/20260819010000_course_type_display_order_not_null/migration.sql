-- course_types.displayOrder was nullable with no default, so every create path
-- that omitted it wrote NULL. Ordering by a NULL column is meaningless (and the
-- value is unusable for reordering), so bring it in line with chapters/lessons/
-- subjects: NOT NULL, default 0.

-- Backfill by creation order within each course, so existing rows keep the
-- order they were already coming back in rather than all collapsing to 0.
UPDATE "course_types" ct
SET "displayOrder" = seq.rn
FROM (
    SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "courseId" ORDER BY "createdAt", "id") - 1) AS rn
    FROM "course_types"
) AS seq
WHERE ct."id" = seq."id" AND ct."displayOrder" IS NULL;

ALTER TABLE "course_types" ALTER COLUMN "displayOrder" SET DEFAULT 0;
ALTER TABLE "course_types" ALTER COLUMN "displayOrder" SET NOT NULL;
