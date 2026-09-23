-- Which subject a lesson teaches.
--
-- Optional, and independent of the chapter it sits in: the Rapid Recall form
-- filters lessons by subject, and nothing else in the schema connects a lesson
-- to one. SET NULL on delete, because losing a subject must not take its
-- lessons with it.
ALTER TABLE "lessons" ADD COLUMN "subjectId" INTEGER;

CREATE INDEX "lessons_subjectId_idx" ON "lessons"("subjectId");

ALTER TABLE "lessons" ADD CONSTRAINT "lessons_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
