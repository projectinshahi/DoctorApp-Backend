-- Images on a test question, for the stem and for each option.

-- questionImage was a placeholder that nothing wrote to; rename rather than
-- add-and-drop so any value it did hold survives.
ALTER TABLE "test_questions" RENAME COLUMN "questionImage" TO "questionImageUrl";

ALTER TABLE "test_questions" ADD COLUMN "optionAImageUrl" TEXT;
ALTER TABLE "test_questions" ADD COLUMN "optionBImageUrl" TEXT;
ALTER TABLE "test_questions" ADD COLUMN "optionCImageUrl" TEXT;
ALTER TABLE "test_questions" ADD COLUMN "optionDImageUrl" TEXT;

-- An image-only question has no text, and an image-only option has no label.
-- Widening to nullable never rejects an existing row.
ALTER TABLE "test_questions" ALTER COLUMN "questionText" DROP NOT NULL;
ALTER TABLE "test_questions" ALTER COLUMN "optionA" DROP NOT NULL;
ALTER TABLE "test_questions" ALTER COLUMN "optionB" DROP NOT NULL;
ALTER TABLE "test_questions" ALTER COLUMN "optionC" DROP NOT NULL;
ALTER TABLE "test_questions" ALTER COLUMN "optionD" DROP NOT NULL;

-- What the CSV import checks its image URLs against.
CREATE TABLE "test_images" (
    "id" SERIAL NOT NULL,
    "testId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_images_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "test_images_url_key" ON "test_images"("url");
CREATE INDEX "test_images_testId_idx" ON "test_images"("testId");

ALTER TABLE "test_images" ADD CONSTRAINT "test_images_testId_fkey"
    FOREIGN KEY ("testId") REFERENCES "tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
