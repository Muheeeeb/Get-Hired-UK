-- Per-month package date tracking (Month 1, Month 2, …), editable at any time.
CREATE TABLE "package_months" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "month_index" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "package_months_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "package_months_client_id_month_index_key" ON "package_months"("client_id", "month_index");
CREATE INDEX "package_months_client_id_start_date_idx" ON "package_months"("client_id", "start_date");

ALTER TABLE "package_months"
    ADD CONSTRAINT "package_months_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Singleton admin-console settings (AI Studio master prompt, …).
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- Master prompt snapshot taken when an AI Studio chat is opened.
ALTER TABLE "ai_studio_conversations" ADD COLUMN "system_prompt" TEXT;
