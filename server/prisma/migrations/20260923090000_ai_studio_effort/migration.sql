-- Thinking effort chosen for an AI Studio chat (low | medium | high | xhigh).
-- Nullable: existing chats keep running at the server default.
ALTER TABLE "ai_studio_conversations" ADD COLUMN "effort" TEXT;
