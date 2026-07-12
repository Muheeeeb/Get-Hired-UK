-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'approved',
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "signup_note" TEXT;
