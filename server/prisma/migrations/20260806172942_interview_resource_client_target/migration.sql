-- AlterTable
ALTER TABLE "interview_resources" ADD COLUMN     "client_id" UUID;

-- AddForeignKey
ALTER TABLE "interview_resources" ADD CONSTRAINT "interview_resources_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
