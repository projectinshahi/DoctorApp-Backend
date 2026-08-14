-- DropForeignKey
ALTER TABLE "lessons" DROP CONSTRAINT "lessons_chapterId_fkey";

-- DropIndex
DROP INDEX "lessons_chapterId_idx";

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "chapters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
