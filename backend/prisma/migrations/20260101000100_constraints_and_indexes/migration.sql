-- Integrity rules Prisma's schema language cannot express.
-- Hand-written; keep every rule here so the database, not just the app, protects the data.

-- ───────────── Identity ─────────────
-- Emails are stored lowercase → plain UNIQUE is case-insensitive.
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_chk" CHECK ("email" = lower("email"));
ALTER TABLE "customers" ADD CONSTRAINT "customers_email_lowercase_chk" CHECK ("email" = lower("email"));

-- ───────────── Catalog ─────────────
ALTER TABLE "taxes" ADD CONSTRAINT "taxes_rate_chk" CHECK ("ratePercent" >= 0 AND "ratePercent" <= 100);
ALTER TABLE "products" ADD CONSTRAINT "products_prices_chk" CHECK ("salesPrice" >= 0 AND "costPrice" >= 0);
ALTER TABLE "plans" ADD CONSTRAINT "plans_price_chk" CHECK ("price" >= 0);
ALTER TABLE "plans" ADD CONSTRAINT "plans_qty_interval_chk" CHECK ("minQuantity" >= 1 AND "billingInterval" >= 1);
ALTER TABLE "plans" ADD CONSTRAINT "plans_window_chk" CHECK ("availableUntil" IS NULL OR "availableUntil" >= "availableFrom");
ALTER TABLE "payment_terms" ADD CONSTRAINT "payment_terms_days_chk" CHECK ("dueDays" >= 0);
ALTER TABLE "quotation_templates" ADD CONSTRAINT "quotation_templates_validity_chk" CHECK ("validityDays" > 0);
ALTER TABLE "quotation_template_lines" ADD CONSTRAINT "qtl_quantity_chk" CHECK ("quantity" > 0);

-- Only one default payment term.
CREATE UNIQUE INDEX "payment_terms_single_default_uq" ON "payment_terms" ("isDefault") WHERE "isDefault";

-- Product / plan names unique among live (non-deleted) rows.
CREATE UNIQUE INDEX "products_name_live_uq" ON "products" (lower("name")) WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "plans_name_live_uq" ON "plans" (lower("name")) WHERE "deletedAt" IS NULL;

-- ───────────── Discounts ─────────────
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_value_chk"
  CHECK ("value" > 0 AND ("type" <> 'PERCENTAGE' OR "value" <= 100));
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_window_chk" CHECK ("endDate" IS NULL OR "endDate" >= "startDate");
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_minimums_chk"
  CHECK (("minPurchaseAmount" IS NULL OR "minPurchaseAmount" >= 0) AND ("minQuantity" IS NULL OR "minQuantity" >= 1));
-- Usage can never exceed the limit, even under concurrent redemption.
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_usage_chk"
  CHECK ("usedCount" >= 0 AND ("usageLimit" IS NULL OR ("usageLimit" >= 1 AND "usedCount" <= "usageLimit")));
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_amount_chk" CHECK ("amount" >= 0);

-- ───────────── Subscriptions ─────────────
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_dates_chk"
  CHECK ("expiryDate" IS NULL OR "expiryDate" >= "startDate");
-- Only billable states carry a nextBillingDate.
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_next_billing_chk"
  CHECK ("nextBillingDate" IS NULL OR "status" IN ('ACTIVE', 'PAUSED'));
ALTER TABLE "subscription_lines" ADD CONSTRAINT "subscription_lines_amounts_chk"
  CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "amount" >= 0);

-- Hot path of the billing job: "which ACTIVE subscriptions are due?"
CREATE INDEX "subscriptions_due_idx" ON "subscriptions" ("nextBillingDate") WHERE "status" = 'ACTIVE';

-- ───────────── Invoices ─────────────
-- "Nothing billed twice": one live invoice per subscription per billing period.
-- Cancelled invoices are excluded so a period can be re-billed after a cancellation.
CREATE UNIQUE INDEX "invoices_subscription_period_uq"
  ON "invoices" ("subscriptionId", "periodStart") WHERE "status" <> 'CANCELLED';

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_period_chk" CHECK ("periodEnd" >= "periodStart");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_due_chk" CHECK ("dueDate" >= "issueDate");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amounts_chk"
  CHECK ("subtotal" >= 0 AND "discountTotal" >= 0 AND "taxTotal" >= 0 AND "total" >= 0
         AND "discountTotal" <= "subtotal");
-- Totals must reconcile exactly.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_total_reconcile_chk"
  CHECK ("total" = "subtotal" - "discountTotal" + "taxTotal");
-- Overpayment is rejected at the database level.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paid_chk" CHECK ("amountPaid" >= 0 AND "amountPaid" <= "total");
-- A confirmed/paid invoice must carry its number; paid means fully paid.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_number_chk"
  CHECK ("status" IN ('DRAFT', 'CANCELLED') OR "number" IS NOT NULL);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paid_status_chk"
  CHECK ("status" <> 'PAID' OR "amountPaid" = "total");

ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_chk"
  CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "discountAmount" >= 0 AND "taxAmount" >= 0
         AND "taxRatePercent" >= 0 AND "taxRatePercent" <= 100);

-- Reporting: outstanding / overdue lists only touch open invoices.
CREATE INDEX "invoices_open_due_idx" ON "invoices" ("dueDate") WHERE "status" = 'CONFIRMED';
CREATE INDEX "invoices_open_customer_idx" ON "invoices" ("customerId") WHERE "status" = 'CONFIRMED';

-- ───────────── Payments ─────────────
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_chk" CHECK ("amount" > 0);

-- ───────────── Platform ─────────────
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_value_chk" CHECK ("lastValue" >= 0);

-- Row-Level Security: the API connects as a privileged role and enforces authorization in
-- application code. On Supabase, tables are also exposed via PostgREST; enabling RLS with no
-- policies denies all access through that surface (anon / authenticated keys) while the
-- backend's direct Postgres connection (BYPASSRLS role) is unaffected.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
