CREATE TYPE "CommentStatus" AS ENUM ('published', 'hidden');

-- Per-lesson kill switch. Defaults true so every existing lesson keeps its
-- thread open; turning it off stops new posts without erasing old ones.
ALTER TABLE "lessons" ADD COLUMN "commentsEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "lesson_comments" (
  "id"        SERIAL PRIMARY KEY,
  "lessonId"  INTEGER NOT NULL,
  "userId"    INTEGER NOT NULL,
  "parentId"  INTEGER,
  "body"      TEXT NOT NULL,
  "status"    "CommentStatus" NOT NULL DEFAULT 'published',
  "editedAt"  TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "lesson_comments_lessonId_fkey" FOREIGN KEY ("lessonId")
    REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lesson_comments_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- Deleting a comment takes its replies with it, which is the stated rule.
  CONSTRAINT "lesson_comments_parentId_fkey" FOREIGN KEY ("parentId")
    REFERENCES "lesson_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "lesson_comments_lessonId_status_createdAt_idx"
  ON "lesson_comments"("lessonId", "status", "createdAt");
CREATE INDEX "lesson_comments_parentId_idx" ON "lesson_comments"("parentId");
CREATE INDEX "lesson_comments_userId_idx" ON "lesson_comments"("userId");

CREATE TABLE "comment_reports" (
  "id"         SERIAL PRIMARY KEY,
  "commentId"  INTEGER NOT NULL,
  "userId"     INTEGER NOT NULL,
  "reason"     TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "comment_reports_commentId_fkey" FOREIGN KEY ("commentId")
    REFERENCES "lesson_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "comment_reports_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- One report per student per comment: ten taps from one angry student is not
-- ten reports.
CREATE UNIQUE INDEX "comment_reports_commentId_userId_key"
  ON "comment_reports"("commentId", "userId");
CREATE INDEX "comment_reports_commentId_resolvedAt_idx"
  ON "comment_reports"("commentId", "resolvedAt");
