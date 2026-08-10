/*
  Warnings:

  - You are about to drop the column `parentId` on the `courses` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "courses" DROP CONSTRAINT "courses_parentId_fkey";

-- DropIndex
DROP INDEX "courses_parentId_idx";

-- AlterTable
ALTER TABLE "courses" DROP COLUMN "parentId",
ADD COLUMN     "examTypeId" INTEGER;

-- CreateTable
CREATE TABLE "exam_categories" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_types" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "examCategoryId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exam_categories_name_key" ON "exam_categories"("name");

-- CreateIndex
CREATE INDEX "exam_types_examCategoryId_idx" ON "exam_types"("examCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "exam_types_name_examCategoryId_key" ON "exam_types"("name", "examCategoryId");

-- CreateIndex
CREATE INDEX "courses_examTypeId_idx" ON "courses"("examTypeId");

-- AddForeignKey
ALTER TABLE "exam_types" ADD CONSTRAINT "exam_types_examCategoryId_fkey" FOREIGN KEY ("examCategoryId") REFERENCES "exam_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_examTypeId_fkey" FOREIGN KEY ("examTypeId") REFERENCES "exam_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
