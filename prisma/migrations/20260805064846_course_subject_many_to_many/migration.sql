/*
  Warnings:

  - You are about to drop the column `subjectId` on the `courses` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "courses" DROP CONSTRAINT "courses_subjectId_fkey";

-- DropIndex
DROP INDEX "courses_subjectId_idx";

-- AlterTable
ALTER TABLE "courses" DROP COLUMN "subjectId";

-- CreateTable
CREATE TABLE "_CourseToSubject" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_CourseToSubject_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_CourseToSubject_B_index" ON "_CourseToSubject"("B");

-- AddForeignKey
ALTER TABLE "_CourseToSubject" ADD CONSTRAINT "_CourseToSubject_A_fkey" FOREIGN KEY ("A") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CourseToSubject" ADD CONSTRAINT "_CourseToSubject_B_fkey" FOREIGN KEY ("B") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
