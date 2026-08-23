-- Hand-picked questions for a quiz. An empty set means the quiz keeps using
-- its subject+topic+examTag filter, so every existing quiz is unaffected.
CREATE TABLE "quiz_questions" (
    "quizId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quiz_questions_pkey" PRIMARY KEY ("quizId","questionId")
);

CREATE INDEX "quiz_questions_questionId_idx" ON "quiz_questions"("questionId");

ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_quizId_fkey"
    FOREIGN KEY ("quizId") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_questionId_fkey"
    FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
