-- Scope a paper to one exam under a course. Null keeps the old behaviour:
-- the test applies to the whole course.
ALTER TABLE "tests" ADD COLUMN "courseTypeId" INTEGER;

ALTER TABLE "tests" ADD CONSTRAINT "tests_courseTypeId_fkey"
    FOREIGN KEY ("courseTypeId") REFERENCES "course_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "tests_courseId_type_isPublished_idx";
CREATE INDEX "tests_courseId_courseTypeId_type_isPublished_idx"
    ON "tests"("courseId", "courseTypeId", "type", "isPublished");
