-- AlterTable
ALTER TABLE "lessons" ADD COLUMN     "planId" INTEGER,
ADD COLUMN     "status" "CourseStatus" NOT NULL DEFAULT 'draft';

-- CreateIndex
CREATE INDEX "lessons_chapterId_displayOrder_idx" ON "lessons"("chapterId", "displayOrder");

-- CreateIndex
CREATE INDEX "lessons_planId_idx" ON "lessons"("planId");

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
