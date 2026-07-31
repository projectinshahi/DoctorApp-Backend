-- AlterTable
ALTER TABLE "users" ADD COLUMN     "password" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'unverified';
