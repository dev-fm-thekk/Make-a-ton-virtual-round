-- Billing run guards.

-- At most ONE scheduler-triggered run per day, even when several API instances all try at once:
-- the first INSERT wins, the others get a unique violation and simply stand down.
CREATE UNIQUE INDEX "billing_runs_scheduler_day_uq" ON "billing_runs" ("runDate") WHERE "triggeredBy" = 'scheduler';

-- "Is a run already in progress?" (checked before every manual run)
CREATE INDEX "billing_runs_running_idx" ON "billing_runs" ("startedAt") WHERE "status" = 'RUNNING';

-- Run counters can't go negative.
ALTER TABLE "billing_runs" ADD CONSTRAINT "billing_runs_counters_chk"
  CHECK ("scanned" >= 0 AND "invoiced" >= 0 AND "skipped" >= 0 AND "failed" >= 0);

-- Payments report / reconciliation reads invoices by the day they were settled.
CREATE INDEX "invoices_paid_at_idx" ON "invoices" ("paidAt") WHERE "status" = 'PAID';

-- A confirmed or paid invoice records when it was confirmed; a paid one records when it was settled.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_timestamps_chk"
  CHECK (("status" NOT IN ('CONFIRMED', 'PAID') OR "confirmedAt" IS NOT NULL) AND ("status" <> 'PAID' OR "paidAt" IS NOT NULL));
