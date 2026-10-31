// Throughput check for the billing engine. Seeds N due subscriptions (3 lines each, half with a product discount),
// bills them at several concurrency levels, prints invoices/second, then DELETES everything it created.
//
//   npx tsx --env-file=.env scripts/perf-billing.ts [subscriptions=60]
//
// NOTE: the figure depends heavily on database latency. Against a remote database (~150 ms/query) expect a few
// invoices/second per worker; with the API next to its database (~1 ms/query) expect hundreds per second.
// The script prints the measured round trip so you can read the numbers in context.

import { toDateOnly, todayUtc } from "../src/lib/dates.js";
import { prisma } from "../src/lib/prisma.js";
import { executeRun } from "../src/modules/billing/engine.js";

const N = Number(process.argv[2] ?? 60);
const TAG = "PERFB";
const today = todayUtc();

async function cleanup() {
  await prisma.$executeRawUnsafe(`DELETE FROM discount_redemptions WHERE "invoiceId" IN (SELECT id FROM invoices WHERE "billToEmail" LIKE '%@perfb.test')`);
  await prisma.$executeRawUnsafe(`DELETE FROM invoices WHERE "billToEmail" LIKE '%@perfb.test'`);
  await prisma.$executeRawUnsafe(`DELETE FROM subscriptions WHERE number LIKE '${TAG}-%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM billing_runs WHERE "triggeredBy" = 'perfb'`);
  await prisma.$executeRawUnsafe(`DELETE FROM discounts WHERE name LIKE '${TAG}%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM quotation_templates WHERE name LIKE '${TAG}%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM plans WHERE name LIKE '${TAG}%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM products WHERE name LIKE '${TAG}%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM taxes WHERE name LIKE '${TAG}%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM payment_terms WHERE name LIKE '${TAG}%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM customers WHERE email LIKE '%@perfb.test'`);
}

async function rtt() {
  const t = performance.now();
  for (let i = 0; i < 5; i++) await prisma.$queryRaw`SELECT 1`;
  return (performance.now() - t) / 5;
}

async function seed() {
  await prisma.$executeRawUnsafe(`INSERT INTO customers (id, name, email, "updatedAt") SELECT gen_random_uuid(), 'perfb ' || g, 'c' || g || '@perfb.test', now() FROM generate_series(1, ${Math.max(10, Math.ceil(N / 4))}) g`);
  await prisma.$executeRawUnsafe(`INSERT INTO payment_terms (id, name, "dueDays", "updatedAt") VALUES (gen_random_uuid(), '${TAG} Net15', 15, now())`);
  await prisma.$executeRawUnsafe(`INSERT INTO taxes (id, name, "ratePercent", "updatedAt") VALUES (gen_random_uuid(), '${TAG} GST', 18, now())`);
  await prisma.$executeRawUnsafe(`INSERT INTO products (id, name, type, "salesPrice", "costPrice", "taxId", "updatedAt") SELECT gen_random_uuid(), '${TAG} product ' || g, 'SERVICE', 100 * g, 10, (SELECT id FROM taxes WHERE name = '${TAG} GST'), now() FROM generate_series(1, 3) g`);
  await prisma.$executeRawUnsafe(`INSERT INTO plans (id, name, price, "billingPeriod", "availableFrom", "updatedAt") VALUES (gen_random_uuid(), '${TAG} Monthly', 100, 'MONTHLY', '2020-01-01', now())`);
  // 10% off product 1 for half of the lines → exercises the discount path (and the guarded usage counter) at volume
  await prisma.$executeRawUnsafe(`INSERT INTO discounts (id, name, type, value, scope, "startDate", "updatedAt") VALUES (gen_random_uuid(), '${TAG} 10pct', 'PERCENTAGE', 10, 'PRODUCT', '2020-01-01', now())`);
  await prisma.$executeRawUnsafe(`INSERT INTO discount_products ("discountId", "productId") SELECT d.id, p.id FROM discounts d, products p WHERE d.name = '${TAG} 10pct' AND p.name = '${TAG} product 1'`);

  await prisma.$executeRawUnsafe(`
    WITH c AS (SELECT id, row_number() OVER (ORDER BY id) rn FROM customers WHERE email LIKE '%@perfb.test')
    INSERT INTO subscriptions (id, number, "customerId", "planId", "paymentTermId", status, "startDate", "nextBillingDate", "activatedAt", "updatedAt")
    SELECT gen_random_uuid(), '${TAG}-' || g, c.id, (SELECT id FROM plans WHERE name = '${TAG} Monthly'), (SELECT id FROM payment_terms WHERE name = '${TAG} Net15'),
           'ACTIVE', date '${toDateOnly(today)}', date '${toDateOnly(today)}', now(), now()
    FROM generate_series(1, ${N}) g JOIN c ON c.rn = 1 + (g % (SELECT count(*) FROM c))`);
  await prisma.$executeRawUnsafe(`
    INSERT INTO subscription_lines (id, "subscriptionId", "productId", "taxId", description, quantity, "unitPrice", amount, "sortOrder", "updatedAt")
    SELECT gen_random_uuid(), s.id, p.id, p."taxId", 'perf line', k, p."salesPrice", k * p."salesPrice", k, now()
    FROM subscriptions s CROSS JOIN generate_series(1, 3) k JOIN products p ON p.name = '${TAG} product ' || k
    WHERE s.number LIKE '${TAG}-%' AND (k <> 1 OR (substring(s.number from '[0-9]+$'))::int % 2 = 0)`);
}

async function resetForRerun() {
  await prisma.$executeRawUnsafe(`DELETE FROM discount_redemptions WHERE "invoiceId" IN (SELECT id FROM invoices WHERE "billToEmail" LIKE '%@perfb.test')`);
  await prisma.$executeRawUnsafe(`UPDATE discounts SET "usedCount" = 0 WHERE name LIKE '${TAG}%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM invoices WHERE "billToEmail" LIKE '%@perfb.test'`);
  await prisma.$executeRawUnsafe(`UPDATE subscriptions SET "nextBillingDate" = date '${toDateOnly(today)}' WHERE number LIKE '${TAG}-%'`);
}

const results: { concurrency: number; seconds: number; invoiced: number; perSec: number; failed: number }[] = [];

try {
  await cleanup();
  const latency = await rtt();
  console.log(`database round trip: ${latency.toFixed(0)} ms per query. Seeding ${N} due subscriptions…`);
  await seed();
  const ids = (await prisma.subscription.findMany({ where: { number: { startsWith: `${TAG}-` } }, select: { id: true } })).map((s) => s.id);

  for (const concurrency of [1, 4, 8]) {
    if (concurrency > 1) await resetForRerun();
    const run = await prisma.billingRun.create({ data: { runDate: today, status: "RUNNING", triggeredBy: "perfb" } });
    const t0 = performance.now();
    const s = await executeRun(run.id, { asOf: today, autoConfirm: false, concurrency, maxInvoices: N + 10, only: ids });
    const seconds = (performance.now() - t0) / 1000;
    results.push({ concurrency, seconds, invoiced: s.invoiced, perSec: s.invoiced / seconds, failed: s.failed });
    console.log(`concurrency ${concurrency}: ${s.invoiced}/${N} invoices in ${seconds.toFixed(1)} s (${(s.invoiced / seconds).toFixed(1)}/s), ${s.failed} failed`);
  }

  const [chk] = await prisma.$queryRaw<{ n: number; dupes: number; bad: number }[]>`
    SELECT COUNT(*)::int AS n,
           (COUNT(*) - COUNT(DISTINCT ("subscriptionId", "periodStart")))::int AS dupes,
           (COUNT(*) FILTER (WHERE "total" <> "subtotal" - "discountTotal" + "taxTotal"))::int AS bad
    FROM invoices WHERE "billToEmail" LIKE '%@perfb.test'`;
  console.log(`\nfinal state: ${chk!.n} invoices, ${chk!.dupes} duplicate periods, ${chk!.bad} with inconsistent totals`);
  const best = results.reduce((a, b) => (b.perSec > a.perSec ? b : a));
  console.log(`best: concurrency ${best.concurrency} at ${best.perSec.toFixed(1)} invoices/s → ${Math.ceil(1000 / best.perSec)} s per 1,000 invoices on this connection`);
  if (chk!.dupes || chk!.bad || results.some((r) => r.failed)) process.exitCode = 1;
} finally {
  await cleanup();
  const left = await prisma.customer.count({ where: { email: { endsWith: "@perfb.test" } } });
  console.log(left === 0 ? "cleaned up: no synthetic rows remain ✓" : `WARNING: ${left} synthetic customers remain!`);
  await prisma.$disconnect();
}
