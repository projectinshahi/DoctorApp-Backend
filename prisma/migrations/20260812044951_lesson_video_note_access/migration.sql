-- AlterTable
ALTER TABLE "lessons" ADD COLUMN     "accessType" "AccessType" NOT NULL DEFAULT 'free',
ADD COLUMN     "noteUrl" TEXT,
ADD COLUMN     "videoUrl" TEXT;
