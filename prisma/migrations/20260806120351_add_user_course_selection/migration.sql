-- AlterTable
ALTER TABLE "users" ADD COLUMN     "selectedCourseId" INTEGER,
ADD COLUMN     "selectedCourseTypeId" INTEGER;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_selectedCourseId_fkey" FOREIGN KEY ("selectedCourseId") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_selectedCourseTypeId_fkey" FOREIGN KEY ("selectedCourseTypeId") REFERENCES "course_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
