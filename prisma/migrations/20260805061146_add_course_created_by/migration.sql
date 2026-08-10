-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "createdBy" INTEGER;

-- CreateIndex
CREATE INDEX "courses_createdBy_idx" ON "courses"("createdBy");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
