ALTER TABLE "conversations" ADD COLUMN "member_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

ALTER TABLE "client_profiles"
  ADD COLUMN "country" TEXT,
  ADD COLUMN "date_of_birth" DATE,
  ADD COLUMN "ni_number" TEXT,
  ADD COLUMN "visa_status" TEXT,
  ADD COLUMN "visa_expiry_date" DATE,
  ADD COLUMN "residential_address" TEXT,
  ADD COLUMN "postcode" TEXT,
  ADD COLUMN "notes" TEXT;
