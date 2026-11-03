-- Free or premium per video instead of per lesson, and a line about each part.
ALTER TABLE "lesson_videos"
    ADD COLUMN "accessType" "AccessType" NOT NULL DEFAULT 'free',
    ADD COLUMN "description" TEXT;

-- Every existing video keeps the lock it has today. Until now a video was
-- locked exactly when its lesson was: the lesson is premium, or its course is,
-- and it is not a free preview. A chapter hangs off a course directly or
-- through a course type, so both paths are followed.
UPDATE "lesson_videos" v
SET "accessType" = 'premium'
FROM "lessons" l
JOIN "chapters" c ON c."id" = l."chapterId"
LEFT JOIN "course_types" ct ON ct."id" = c."courseTypeId"
LEFT JOIN "courses" co ON co."id" = COALESCE(c."courseId", ct."courseId")
WHERE v."lessonId" = l."id"
  AND l."isFreePreview" = false
  AND (l."accessType" = 'premium' OR co."accessType" = 'premium');
