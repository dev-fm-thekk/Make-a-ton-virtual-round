-- The daily billing scheduler is configured in the app (Billing page), not in environment variables.
-- A single row: the CHECK makes a second row impossible.
CREATE TABLE "billing_settings" (
  "id"               INTEGER      NOT NULL DEFAULT 1,
  "schedulerEnabled" BOOLEAN      NOT NULL DEFAULT false,
  "runHourUtc"       INTEGER      NOT NULL DEFAULT 1,
  "autoConfirm"      BOOLEAN      NOT NULL DEFAULT false,
  "updatedAt"        TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedById"      UUID,
  CONSTRAINT "billing_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_settings_singleton_chk" CHECK ("id" = 1),
  CONSTRAINT "billing_settings_hour_chk" CHECK ("runHourUtc" BETWEEN 0 AND 23)
);
INSERT INTO "billing_settings" ("id") VALUES (1);
