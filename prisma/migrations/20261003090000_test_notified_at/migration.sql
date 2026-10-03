-- Records that students were told about a test, so republishing after a fix
-- does not send a second announcement for the same paper.
ALTER TABLE "tests" ADD COLUMN "notifiedAt" TIMESTAMP(3);

-- Everything already live has been announced. Without this, the next publish
-- of any existing test would read as a first announcement and notify again.
UPDATE "tests" SET "notifiedAt" = "updatedAt" WHERE "isPublished" = true;
