-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "parentId" INTEGER;

-- CreateIndex
CREATE INDEX "courses_parentId_idx" ON "courses"("parentId");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
