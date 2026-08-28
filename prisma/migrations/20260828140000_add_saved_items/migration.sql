-- Bookmarks. The (user, target) pair is the primary key, so saving twice is an
-- upsert rather than a duplicate row.
CREATE TABLE "saved_questions" (
    "userId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_questions_pkey" PRIMARY KEY ("userId","questionId")
);

CREATE TABLE "saved_lessons" (
    "userId" INTEGER NOT NULL,
    "lessonId" INTEGER NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_lessons_pkey" PRIMARY KEY ("userId","lessonId")
);

-- "This student's bookmarks, newest first" is the only listing query.
CREATE INDEX "saved_questions_userId_savedAt_idx" ON "saved_questions"("userId", "savedAt");
CREATE INDEX "saved_lessons_userId_savedAt_idx" ON "saved_lessons"("userId", "savedAt");

ALTER TABLE "saved_questions" ADD CONSTRAINT "saved_questions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saved_questions" ADD CONSTRAINT "saved_questions_questionId_fkey"
    FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "saved_lessons" ADD CONSTRAINT "saved_lessons_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saved_lessons" ADD CONSTRAINT "saved_lessons_lessonId_fkey"
    FOREIGN KEY ("lessonId") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
