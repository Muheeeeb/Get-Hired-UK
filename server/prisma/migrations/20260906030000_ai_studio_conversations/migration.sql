CREATE TABLE "ai_studio_conversations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "client_id" UUID,
    "domain_id" UUID,
    "kind" TEXT NOT NULL DEFAULT 'cv',
    "model" TEXT,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_studio_conversations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_studio_conversations_user_id_updated_at_idx"
ON "ai_studio_conversations"("user_id", "updated_at");

ALTER TABLE "ai_studio_conversations"
ADD CONSTRAINT "ai_studio_conversations_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_studio_conversations"
ADD CONSTRAINT "ai_studio_conversations_client_id_fkey"
FOREIGN KEY ("client_id") REFERENCES "client_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_studio_conversations"
ADD CONSTRAINT "ai_studio_conversations_domain_id_fkey"
FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
