-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('new', 'contacted', 'closed');

-- CreateTable
CREATE TABLE "consultation_requests" (
    "id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "interest" TEXT,
    "message" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'new',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultation_requests_pkey" PRIMARY KEY ("id")
);
