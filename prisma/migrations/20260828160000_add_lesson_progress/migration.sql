-- Per-lesson watch progress. Needed for the home screen's module counts and
-- for "continue watching"; nothing tracked this before.
CREATE TABLE "lesson_progress" (
    "userId" INTEGER NOT NULL,
    "lessonId" INTEGER NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "lastPositionSeconds" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("userId","lessonId")
);

CREATE INDEX "lesson_progress_userId_updatedAt_idx" ON "lesson_progress"("userId", "updatedAt");

ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_lessonId_fkey"
    FOREIGN KEY ("lessonId") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
