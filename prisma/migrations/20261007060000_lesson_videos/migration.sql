-- A lesson can carry more than one video.
--
-- lessons.video_url and friends are untouched: they keep holding video 1 and
-- are written from this table, so nothing that reads them has to change.
CREATE TABLE "lesson_videos" (
    "id" SERIAL NOT NULL,
    "lessonId" INTEGER NOT NULL,
    "title" TEXT,
    "videoUrl" TEXT NOT NULL,
    "videoPublicId" TEXT,
    "thumbnailUrl" TEXT,
    "durationSeconds" INTEGER,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_videos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lesson_videos_lessonId_displayOrder_idx" ON "lesson_videos"("lessonId", "displayOrder");

ALTER TABLE "lesson_videos" ADD CONSTRAINT "lesson_videos_lessonId_fkey"
    FOREIGN KEY ("lessonId") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every lesson that already has a video becomes a one-video lesson, so the
-- panel's new list is never empty for content that already exists.
INSERT INTO "lesson_videos" ("lessonId", "videoUrl", "videoPublicId", "thumbnailUrl", "durationSeconds", "displayOrder", "updatedAt")
SELECT "id", "videoUrl", "videoPublicId", "thumbnailUrl", "durationSeconds", 0, CURRENT_TIMESTAMP
FROM "lessons"
WHERE "videoUrl" IS NOT NULL AND "videoUrl" <> '';
