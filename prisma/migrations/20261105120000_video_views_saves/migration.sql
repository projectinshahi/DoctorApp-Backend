-- How many times each video was started, and a bookmark per video.
ALTER TABLE "lesson_videos" ADD COLUMN "viewCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "saved_videos" (
    "userId" INTEGER NOT NULL,
    "videoId" INTEGER NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_videos_pkey" PRIMARY KEY ("userId","videoId")
);

CREATE INDEX "saved_videos_userId_savedAt_idx" ON "saved_videos"("userId", "savedAt");

ALTER TABLE "saved_videos" ADD CONSTRAINT "saved_videos_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saved_videos" ADD CONSTRAINT "saved_videos_videoId_fkey"
    FOREIGN KEY ("videoId") REFERENCES "lesson_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
