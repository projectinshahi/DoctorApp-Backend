-- A rapid recall deck belongs to a chapter.
--
-- An admin builds a course as course -> exam type -> chapter -> lesson and
-- calls the chapter the subject: "Internal Medicine", "General Surgery". The
-- subjects table is the question bank's own list ("Internal Med", "OBGYN") and
-- no course links to it, which is why picking a subject there had nothing to
-- do with the lessons on offer.
ALTER TABLE "rapid_recalls" ADD COLUMN "chapterId" INTEGER;

CREATE INDEX "rapid_recalls_chapterId_idx" ON "rapid_recalls"("chapterId");

ALTER TABLE "rapid_recalls" ADD CONSTRAINT "rapid_recalls_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "chapters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill from the lesson a deck already points at: its chapter is the one
-- the deck was always about.
UPDATE "rapid_recalls" r
SET "chapterId" = l."chapterId"
FROM "lessons" l
WHERE r."lessonId" = l.id AND r."chapterId" IS NULL;

-- Undo this morning's lesson.subjectId: it modelled a lesson as carrying a
-- question-bank subject, which is not how a course is built here. Nothing was
-- ever written to it.
DROP INDEX IF EXISTS "lessons_subjectId_idx";
ALTER TABLE "lessons" DROP CONSTRAINT IF EXISTS "lessons_subjectId_fkey";
ALTER TABLE "lessons" DROP COLUMN IF EXISTS "subjectId";
