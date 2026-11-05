-- Draft or published per video, following the lesson.
ALTER TABLE "lesson_videos" ADD COLUMN "status" "CourseStatus" NOT NULL DEFAULT 'published';

-- A lesson that is not published has no published videos.
UPDATE "lesson_videos" v
SET "status" = 'draft'
FROM "lessons" l
WHERE v."lessonId" = l."id" AND l."status" <> 'published';
