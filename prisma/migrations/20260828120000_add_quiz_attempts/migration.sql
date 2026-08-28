-- One student's run at one quiz. questionIds freezes the served set, because a
-- filter quiz samples randomly and the review must score the same draw.
CREATE TABLE "quiz_attempts" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "quizId" INTEGER NOT NULL,
    "lessonId" INTEGER NOT NULL,
    "questionIds" INTEGER[],
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "quiz_attempts_pkey" PRIMARY KEY ("id")
);

-- One answered question. A skipped question has no row — absence is the record.
CREATE TABLE "attempt_answers" (
    "attemptId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "selectedOptionId" INTEGER NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "marksAwarded" DOUBLE PRECISION NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attempt_answers_pkey" PRIMARY KEY ("attemptId","questionId")
);

CREATE INDEX "quiz_attempts_userId_lessonId_startedAt_idx"
    ON "quiz_attempts"("userId", "lessonId", "startedAt");

ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_quizId_fkey"
    FOREIGN KEY ("quizId") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attempt_answers" ADD CONSTRAINT "attempt_answers_attemptId_fkey"
    FOREIGN KEY ("attemptId") REFERENCES "quiz_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
