-- Grand Test: a fixed exam paper that owns its own questions. Nothing here is
-- shared with the quiz tables — a Quiz resolves a filter, a Test does not.
CREATE TYPE "TestType" AS ENUM ('GRAND_TEST');

CREATE TABLE "tests" (
    "id" SERIAL NOT NULL,
    "courseId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TestType" NOT NULL DEFAULT 'GRAND_TEST',
    "totalQuestions" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "marksCorrect" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "marksIncorrect" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "test_questions" (
    "id" SERIAL NOT NULL,
    "testId" INTEGER NOT NULL,
    "questionOrder" INTEGER NOT NULL,
    "questionText" TEXT NOT NULL,
    "questionImage" TEXT,
    "optionA" TEXT NOT NULL,
    "optionB" TEXT NOT NULL,
    "optionC" TEXT NOT NULL,
    "optionD" TEXT NOT NULL,
    "correctOption" TEXT NOT NULL,
    "explanation" TEXT,
    "subject" TEXT,
    "topic" TEXT,

    CONSTRAINT "test_questions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "test_attempts" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "testId" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "score" DOUBLE PRECISION,

    CONSTRAINT "test_attempts_pkey" PRIMARY KEY ("id")
);

-- No row means skipped, so a blank scores 0 rather than the negative mark.
CREATE TABLE "test_attempt_answers" (
    "attemptId" INTEGER NOT NULL,
    "testQuestionId" INTEGER NOT NULL,
    "selectedOption" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "marksAwarded" DOUBLE PRECISION NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_attempt_answers_pkey" PRIMARY KEY ("attemptId","testQuestionId")
);

CREATE INDEX "tests_courseId_type_isPublished_idx" ON "tests"("courseId", "type", "isPublished");
CREATE UNIQUE INDEX "test_questions_testId_questionOrder_key" ON "test_questions"("testId", "questionOrder");
CREATE INDEX "test_questions_testId_idx" ON "test_questions"("testId");
CREATE INDEX "test_attempts_userId_testId_startedAt_idx" ON "test_attempts"("userId", "testId", "startedAt");
CREATE INDEX "test_attempt_answers_testQuestionId_idx" ON "test_attempt_answers"("testQuestionId");

ALTER TABLE "tests" ADD CONSTRAINT "tests_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "test_questions" ADD CONSTRAINT "test_questions_testId_fkey"
    FOREIGN KEY ("testId") REFERENCES "tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "test_attempts" ADD CONSTRAINT "test_attempts_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "test_attempts" ADD CONSTRAINT "test_attempts_testId_fkey"
    FOREIGN KEY ("testId") REFERENCES "tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "test_attempt_answers" ADD CONSTRAINT "test_attempt_answers_attemptId_fkey"
    FOREIGN KEY ("attemptId") REFERENCES "test_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "test_attempt_answers" ADD CONSTRAINT "test_attempt_answers_testQuestionId_fkey"
    FOREIGN KEY ("testQuestionId") REFERENCES "test_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
