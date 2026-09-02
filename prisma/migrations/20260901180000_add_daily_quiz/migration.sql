-- Today's questions are derived from (courseId, date), not stored, so there is
-- no table of scheduled sets here and nothing to populate ahead of time.
-- questionIds freezes the derivation once a student opens it.
CREATE TABLE "daily_quiz_attempts" (
  "id"          SERIAL PRIMARY KEY,
  "userId"      INTEGER NOT NULL,
  "courseId"    INTEGER NOT NULL,
  "quizDate"    DATE NOT NULL,
  "questionIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "startedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "daily_quiz_attempts_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "daily_quiz_attempts_courseId_fkey" FOREIGN KEY ("courseId")
    REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- One go per student per course per day. Unlimited retries would make this
-- practice rather than a daily quiz, and would make a streak meaningless.
CREATE UNIQUE INDEX "daily_quiz_attempts_userId_courseId_quizDate_key"
  ON "daily_quiz_attempts"("userId", "courseId", "quizDate");
CREATE INDEX "daily_quiz_attempts_userId_courseId_quizDate_idx"
  ON "daily_quiz_attempts"("userId", "courseId", "quizDate");

CREATE TABLE "daily_quiz_answers" (
  "attemptId"        INTEGER NOT NULL,
  "questionId"       INTEGER NOT NULL,
  "selectedOptionId" INTEGER NOT NULL,
  "isCorrect"        BOOLEAN NOT NULL,
  "marksAwarded"     DOUBLE PRECISION NOT NULL,
  "answeredAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_quiz_answers_pkey" PRIMARY KEY ("attemptId", "questionId"),
  CONSTRAINT "daily_quiz_answers_attemptId_fkey" FOREIGN KEY ("attemptId")
    REFERENCES "daily_quiz_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
