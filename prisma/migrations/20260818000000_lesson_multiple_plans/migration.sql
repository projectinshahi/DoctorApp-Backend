-- A lesson can now be unlocked by any number of plans.
-- Order matters: the existing lessons.planId values are copied into the join
-- table BEFORE the column is dropped, so nothing already configured is lost.

CREATE TABLE "lesson_plans" (
    "lessonId" INTEGER NOT NULL,
    "planId" INTEGER NOT NULL,

    CONSTRAINT "lesson_plans_pkey" PRIMARY KEY ("lessonId","planId")
);

CREATE INDEX "lesson_plans_planId_idx" ON "lesson_plans"("planId");

-- Backfill from the single-plan column.
INSERT INTO "lesson_plans" ("lessonId", "planId")
SELECT "id", "planId" FROM "lessons" WHERE "planId" IS NOT NULL;

ALTER TABLE "lesson_plans" ADD CONSTRAINT "lesson_plans_lessonId_fkey"
    FOREIGN KEY ("lessonId") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lesson_plans" ADD CONSTRAINT "lesson_plans_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Retire the single-plan column.
ALTER TABLE "lessons" DROP CONSTRAINT IF EXISTS "lessons_planId_fkey";
DROP INDEX IF EXISTS "lessons_planId_idx";
ALTER TABLE "lessons" DROP COLUMN "planId";
