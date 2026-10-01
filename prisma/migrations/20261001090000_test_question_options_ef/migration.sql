-- Two more answer slots for papers that run to six.
--
-- Nullable with no default: an existing four-option question is already
-- correct as it stands, and backfilling empty strings would turn "no option E"
-- into "option E that is blank", which the validator would then have to tell
-- apart from a real one.
ALTER TABLE "test_questions" ADD COLUMN "optionE"         TEXT;
ALTER TABLE "test_questions" ADD COLUMN "optionEImageUrl" TEXT;
ALTER TABLE "test_questions" ADD COLUMN "optionF"         TEXT;
ALTER TABLE "test_questions" ADD COLUMN "optionFImageUrl" TEXT;
