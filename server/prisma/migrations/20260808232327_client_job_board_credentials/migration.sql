-- CreateEnum
CREATE TYPE "CredentialService" AS ENUM ('email', 'linkedin', 'indeed', 'nhs_jobs');

-- CreateTable
CREATE TABLE "client_credentials" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "service" "CredentialService" NOT NULL,
    "username" TEXT NOT NULL,
    "secret_enc" TEXT NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credential_access_log" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "service" "CredentialService" NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credential_access_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_credentials_client_id_service_key" ON "client_credentials"("client_id", "service");

-- CreateIndex
CREATE INDEX "credential_access_log_client_id_created_at_idx" ON "credential_access_log"("client_id", "created_at");

-- AddForeignKey
ALTER TABLE "client_credentials" ADD CONSTRAINT "client_credentials_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_access_log" ADD CONSTRAINT "credential_access_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
