/*
  Warnings:

  - You are about to drop the column `examTypeId` on the `courses` table. All the data in the column will be lost.
  - You are about to drop the `exam_categories` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `exam_types` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "courses" DROP CONSTRAINT "courses_examTypeId_fkey";

-- DropForeignKey
ALTER TABLE "exam_types" DROP CONSTRAINT "exam_types_examCategoryId_fkey";

-- DropIndex
DROP INDEX "courses_examTypeId_idx";

-- AlterTable
ALTER TABLE "chapters" ADD COLUMN     "courseTypeId" INTEGER,
ALTER COLUMN "courseId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "courses" DROP COLUMN "examTypeId";

-- DropTable
DROP TABLE "exam_categories";

-- DropTable
DROP TABLE "exam_types";

-- CreateTable
CREATE TABLE "course_types" (
    "id" SERIAL NOT NULL,
    "courseId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "CourseStatus" NOT NULL DEFAULT 'draft',
    "accessType" "AccessType" NOT NULL DEFAULT 'free',
    "displayOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "course_types_courseId_idx" ON "course_types"("courseId");

-- CreateIndex
CREATE INDEX "chapters_courseTypeId_idx" ON "chapters"("courseTypeId");

-- AddForeignKey
ALTER TABLE "course_types" ADD CONSTRAINT "course_types_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_courseTypeId_fkey" FOREIGN KEY ("courseTypeId") REFERENCES "course_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
