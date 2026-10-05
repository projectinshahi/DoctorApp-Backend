-- free or premium per question, the same choice a lesson has.
--
-- Defaults to free: every question written before today stays visible to
-- everyone, so shipping this locks nothing by surprise. An admin opts a
-- question into premium.
ALTER TABLE "questions" ADD COLUMN "accessType" "AccessType" NOT NULL DEFAULT 'free';

DROP INDEX IF EXISTS "questions_subjectId_topicId_status_idx";
CREATE INDEX "questions_subjectId_topicId_status_accessType_idx"
  ON "questions"("subjectId", "topicId", "status", "accessType");
