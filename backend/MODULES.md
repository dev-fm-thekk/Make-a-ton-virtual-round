# Module split – who builds what

Foundations are **done** (don't rebuild): env, Prisma client, error envelope, logging, `authenticate` /
`requireRole` / `requireStaff`, `validate`, `audit`, pagination helpers, `nextDocumentNumber`, mailer, auth + users.
Reference implementation to copy: `src/modules/users/users.routes.ts` and `src/modules/auth/*`.

## Ground rules (every module)

1. **Folder:** `src/modules/<name>/` with `<name>.routes.ts`, `<name>.schemas.ts` (zod), `<name>.service.ts`. Routes are thin; logic and `prisma` calls live in the service.
2. **Mount** with one line in `src/app.ts`: `v1.use("/<name>", <name>Router);`. This is the only shared file you touch (expect trivial merge conflicts: keep both lines).
3. **Never change `schema.prisma` ad hoc.** Need a column/index? Tell the group, one person adds a migration. Never edit an applied migration.
4. **Auth on every route:** `authenticate` first, then `requireRole(...)`. Customers (`req.auth.customerId`) must only ever see their own rows — filter in the query, not after.
5. **Validate all input** with `validate({ body|query|params })`. Throw `AppError` helpers (`notFound`, `conflict`, `badRequest`…) – never hand-write error JSON.
6. **Money is `Prisma.Decimal`**, never `number`; send as strings in JSON. Multi-row writes use `prisma.$transaction`. Soft-delete master data (`deletedAt`).
7. **Lists** use `paginationQuery` / `pageArgs` / `pageResult`. Add `audit(req, …)` on create/update/state-change.
8. Branch per package, small PRs into `main`.

## Work packages

| # | Package | Owns tables | Endpoints (under `/api/v1`) | Access | Depends on |
|---|---|---|---|---|---|
| 0 | **Foundation, Auth, Users** ✅ | User, RefreshToken, PasswordResetToken, AuditLog | `/auth/*`, `/users/*` | – | – |
| 1 | **Catalog** ✅ | Tax, Product, ProductVariant, PaymentTerm | `/taxes`, `/products` (+ `/:id/variants`), `/payment-terms` | Admin write; Staff read | – |
| 2 | **Plans & quotation templates** ✅ | Plan, QuotationTemplate(+Line) | `/plans`, `/quotation-templates` | Admin write; Staff read | 1 (reads Product) |
| 3 | **Customers** ✅ | Customer | `/customers` (staff CRUD, search); `/me/profile` (customer edits own) | Staff/Admin; Customer = self | – |
| 4 | **Subscriptions** ✅ | Subscription, SubscriptionLine, SubscriptionStatusHistory | `/subscriptions` CRUD, lines, `POST /:id/transition` (confirm/activate/pause/resume/close/renew), create-from-template; customer portal `GET` of own | Staff/Admin write; Customer read-own | 1, 2, 3 (code against the schema; use seed data) |
| 5 | **Discounts** ✅ | Discount, DiscountProduct, SubscriptionDiscount | `/discounts` CRUD, attach to products / subscriptions, usage report | Admin write; Staff read | 1 |
| 6 | **Billing engine & invoices** ✅ | BillingRun, Invoice, InvoiceLine, DiscountRedemption | `POST /billing/run`, `/invoices` list/get, `confirm` / `cancel` / `send` / `print` (PDF/HTML), customer portal read-own | Staff/Admin; Customer read-own | 4, 5 (calls their services) |
| 7 | **Payments** ✅ | Payment | `POST /invoices/:id/payments` (idempotency key), `GET /payments`, `GET /invoices/:id/payments` | Staff/Admin record; Customer read-own | 6 |
| 8 | **Reporting** ✅ | – (read-only SQL over everything) | `/reports/summary`, `/reports/revenue`, `/reports/overdue`, `/reports/subscriptions` (filters, paging) | Admin/Staff | 4, 6, 7 |
| F | **Frontend** (Next.js, `frontend/`) | – | consumes the API | – | contracts below |

Suggested split for three people: **A** = 1 → 2 → 5, **B** = 3 → 4 → 8, **C** = 6 → 7. Frontend can start immediately on
auth screens + layouts against `/auth/*`, then follow the API as packages land.

### Hard rules inside the heavy packages

**4 Subscriptions** – allowed transitions: `DRAFT→QUOTATION→CONFIRMED→ACTIVE`, `ACTIVE⇄PAUSED` (only if `plan.allowPause`), `ACTIVE|PAUSED→CLOSED` (early close only if `plan.allowEarlyClose`), renewal only if `plan.allowRenewal`. Every transition: check `version` (optimistic lock), write `SubscriptionStatusHistory`, in one tx. Number via `nextDocumentNumber(tx, "SUB")`. On activate, set `nextBillingDate = startDate`; clear it on close. `plan.autoCloseOnEnd` is closed by a daily job (owner: 6's scheduler).

**5 Discounts** – only CRUD + attaching (`DiscountProduct`, `SubscriptionDiscount`). The calculation lives in the billing engine (`billing/calc.ts`, already done and tested), so Package 5 must NOT change `usedCount` itself. For reference, redemption is a guarded update: `UPDATE discounts SET "usedCount"="usedCount"+1 WHERE id=$1 AND ("usageLimit" IS NULL OR "usedCount"<"usageLimit")`; 0 rows → not applied.

**6 Billing** – the engine must be: (a) **idempotent** – relies on the partial unique index `(subscriptionId, periodStart)`; catch the unique violation and count it as "skipped"; (b) **concurrent-safe** – claim work with `SELECT … FOR UPDATE SKIP LOCKED`; (c) **atomic per subscription** – invoice + lines + `DiscountRedemption` + `nextBillingDate` advance in one tx; one failing subscription must not abort the run (record in `BillingRun.errors`). Invoice number assigned on confirm via `nextDocumentNumber(tx, "INV")`. Totals must satisfy `total = subtotal − discountTotal + taxTotal` (DB CHECK).

**7 Payments** – in one tx: `SELECT … FOR UPDATE` the invoice → reject if not `CONFIRMED` or amount would exceed `total − amountPaid` → insert payment → bump `amountPaid` → set `PAID` + `paidAt` when fully paid.

**8 Reporting** – every endpoint must answer < 2 s on thousands of rows: aggregate in SQL (`groupBy` / `$queryRaw`), never load rows into Node to sum. Overdue = `status='CONFIRMED' AND dueDate < today`. Check `EXPLAIN` against the partial indexes in the constraints migration.

## Cross-package contracts (agree these early)

- JSON error shape: `{ error: { code, message, details? } }`. Lists: `{ items, page, limit, total, totalPages }`. Money as strings (`"1250.00"`), dates as ISO strings.
- Package 6 → 4: `subscriptionService.getBillable(tx, asOf, batchSize)` and `advanceBilling(tx, subscriptionId)`. Package 6 → 5: `findApplicableDiscounts`. Package 8 reads tables directly (read-only).
- Seed data (`npm run db:seed`) provides the admin and payment terms; add catalog fixtures to `prisma/seed.ts` so everyone develops against the same data.

## Frontend conventions (`frontend/`)

Run both: `cd backend && npm run dev` (:4000) and `cd frontend && cp .env.example .env.local && npm run dev` (:3000).
The browser only calls `/api/v1/*` on the Next origin; `next.config.ts` proxies it to the API (first-party cookie, no CORS).

- **Add a screen:** create `frontend/app/(app)/<route>/page.tsx` (server component exporting `metadata`, rendering a `"use client"` view in `components/<feature>/`), then flip `ready: true` in `frontend/lib/nav.ts`. Auth gating, role-filtered sidebar and the shell are automatic.
- **Call the API** only through `lib/api.ts` (`get/post/patch/del`): it attaches the token, refreshes on 401 and throws `ApiError`. Read data with TanStack Query (`useQuery`, `useMutation`; see `components/users/users-view.tsx`).
- **Forms:** react-hook-form + zod; surface server errors with `applyApiError` (`lib/forms.ts`).
- **UI:** build from `components/ui.tsx` (Button, Input, Select, Card, Badge, Modal, PageHeader…) and the semantic colour tokens in `globals.css` (`bg-surface`, `text-muted`…), never raw colours.
- Next.js 16 with Cache Components: pages that call `useSearchParams` need a `<Suspense>` boundary. Read `frontend/node_modules/next/dist/docs/` before using Next APIs from memory.

## Implemented: Packages 3, 4, 8

Run `npm test` (unit, no DB), `npm run test:integration` (38 HTTP tests against the DB in `.env`; creates and deletes `zzt…`-tagged rows),
and `npx tsx --env-file=.env scripts/perf-reports.ts` (seeds ~100k invoices inside a transaction that is rolled back, then times every report).

### Customers (`/customers`, `/me`)
| Endpoint | Who | Notes |
|---|---|---|
| `GET /customers?search&hasPortalAccess&sort&page&limit` | staff | each item has `activeSubscriptions` |
| `POST /customers` · `PATCH /customers/:id` | staff | duplicate email → 409 with `details.existingCustomerId`; `null` clears optional fields |
| `GET /customers/:id` | staff | + `subscriptionsByStatus`, `outstandingBalance`, `overdueBalance` |
| `DELETE /customers/:id` | admin | soft delete; 409 while subscriptions aren't CLOSED or invoices are DRAFT/CONFIRMED; also disables their login |
| `GET/PATCH /me/profile` | customer | own profile only; internal `notes` never exposed |

### Subscriptions (`/subscriptions`)
| Endpoint | Who | Notes |
|---|---|---|
| `GET /subscriptions?status=ACTIVE,PAUSED&customerId&planId&search&startFrom&startTo&sort` | staff all, customer own | items carry per-period `totals` |
| `GET /subscriptions/:id` | staff, customer own (404 otherwise) | lines, totals, `history`, `availableActions` for the caller |
| `POST /subscriptions` | staff | `{customerId, planId \| quotationTemplateId, startDate, expiryDate?, paymentTermId?, lines?}`; template copies plan + lines and sets `quoteValidUntil`; prices come from the catalog (`salesPrice + variant.extraPrice`) unless `unitPrice` is given |
| `PATCH /subscriptions/:id` · `PUT /subscriptions/:id/lines` | staff | only in DRAFT/QUOTATION; **`version` required** (optimistic lock) |
| `POST /subscriptions/:id/transition` `{action, version, reason?, expiryDate?}` | by action (see `state-machine.ts`) | `send_quotation, confirm, activate, pause, resume, close, renew` |
| `POST /subscriptions/maintenance/close-expired` | admin | closes expired subs on plans with `autoCloseOnEnd` (scheduler should call `closeExpiredSubscriptions()` daily) |

Stable error codes (HTTP 409 unless noted): `STALE_VERSION` (reload and retry), `INVALID_TRANSITION`, `PLAN_RULE` (plan switch forbids it), `PLAN_UNAVAILABLE`, `QUOTE_EXPIRED`, `MIN_QUANTITY`, `NO_LINES`, `NOT_EDITABLE`, `NO_EXPIRY`.

**Billing contract for Package 6** (`modules/subscriptions/subscriptions.billing.ts`, use inside one `prisma.$transaction` per subscription):
`claimDueSubscriptions(tx, asOf, limit)` → locks due ACTIVE subs (`SKIP LOCKED`) with plan, term, customer, lines+tax, discounts;
`currentPeriod(sub)` → `{periodStart, periodEnd}`; `advanceBilling(tx, sub)` → moves `nextBillingDate` (null after expiry). Schedules are computed from the start date, so month-end subscriptions don't drift (Jan 31 → Feb 28 → Mar 31).

### Reporting (`/reports`, admin + staff)
`GET /summary`, `/revenue?groupBy=day|week|month`, `/overdue` (aging buckets + list), `/invoices?state=all|paid|outstanding|overdue`, `/payments`, `/subscriptions` (MRR by plan).
Conventions: all days are UTC; **overdue** = status `CONFIRMED` and `dueDate < today`; **revenue** = payments received; **MRR** = ACTIVE subscriptions' line amounts (pre-tax, pre-discount) normalised to a month. Money is always a 2-decimal string.
Measured against 20k subscriptions / 95k invoices / 80k payments over a 166 ms-per-query link, all endpoints finish in 0.2–1.5 s (budget 2 s); production, with the API next to the DB, will be faster.

### Decisions to confirm
1. `plan.price` is informational: invoices bill from **subscription lines** (product price + variant extra), as the brief's "lines showing product, quantity, unit price, taxes and amount" describes.
2. `plan.minQuantity` = minimum **total** quantity across lines, enforced when a quotation is confirmed.
3. Activating a subscription whose start date is in the past does **not** back-bill: billing starts at the next scheduled date on/after today.
4. Discounts (Package 5) attach via `SubscriptionDiscount`; `claimDueSubscriptions` already returns them so the engine can apply them.

## Frontend for Packages 3, 4, 8

Code lives in `frontend/features/<name>/` (api hooks, types, views); pages under `frontend/app/(app)/` are thin server components.
Run `npm test` in `frontend/` for the logic tests (money/preview maths, lifecycle rules, date ranges, chart scales).

| Area | Routes | Notes |
|---|---|---|
| Customers | `/customers`, `/customers/:id` | filters live in the URL; create/edit modal; admin-only delete explains why it is refused |
| Subscriptions | `/subscriptions`, `/subscriptions/new`, `/subscriptions/:id` | template or scratch; live price preview (matches server rounding); lifecycle buttons come from the API's `availableActions`, disabled with a reason when the plan forbids them; `version` is sent on every change (stale edits reload instead of overwriting) |
| Customer portal | `/my/subscriptions`, `/my/subscriptions/:id`, `/account` (billing details) | same components in `mode="customer"`: no customer column, no editing, no internal notes |
| Reports | `/reports` (overview), `/reports/invoices`, `/payments`, `/overdue`, `/subscriptions` | one date range shared in the URL; charts are plain SVG using theme tokens (validated blue/orange pair), with tooltip, keyboard and table view |
| Dashboard | `/dashboard` | staff: this month's finance overview; customers: their own subscriptions |

Gotchas worth knowing:
- SVG `stroke="var(--x)"` attributes don't work; colours from CSS variables must go through `style` (comment in `line-chart.tsx`).
- Dynamic routes (`[id]`) need a `<Suspense>` above any client component that reads the URL (Cache Components): see `app/(app)/layout.tsx`.
- Next keeps previously visited pages mounted (hidden) for instant back-navigation, so don't rely on global DOM queries or fixed ids.

### Demo data
`cd backend && npm run demo:seed` creates 6 customers, a catalog, 9 subscriptions in every status and ~6 months of invoices/payments (some overdue).
Logins (password `Demo!Passw0rd1`): `admin@demo.test`, `staff@demo.test`, `customer@demo.test`. `npm run demo:clear` removes exactly that data.

## Implemented: Packages 6 and 7 (billing, invoices, payments)

Tests: `npm test` (unit, incl. the pure invoice calculator), `npm run test:integration` (real DB: engine, concurrency, discounts, invoices, payments; ~7 min over a remote DB),
`npx tsx --env-file=.env scripts/perf-billing.ts [n]` (seeds n due subscriptions, bills them at 1/4/8 workers, cleans up).

### How billing works
1. **Billing day:** the scheduler (or an admin) runs the engine. It claims due ACTIVE subscriptions one at a time with `FOR UPDATE SKIP LOCKED`, builds the invoice, applies discounts, and moves `nextBillingDate`, **all in one transaction per invoice**.
2. **Nothing billed twice:** one live invoice per (subscription, period): checked in the transaction and enforced by a unique index. **Nothing skipped:** a failure rolls the invoice back and the subscription stays due; late subscriptions catch up one period per invoice.
3. Invoices are created as **DRAFT** (no number) for review, then confirmed (numbered `INV-YYYY-nnnnnn`, gap-free), or created confirmed when `autoConfirm` is on. Zero-value invoices settle themselves on confirm.
4. **Discounts** (rules in `billing/calc.ts`): applied before tax; product-scoped first, then subscription-scoped, each on what is left; min quantity/purchase checked on the targeted lines' original amounts; a discount is split across lines to the exact cent. Usage limits are a guarded `UPDATE` (exactly `usageLimit` invoices win, however many workers race); cancelling an unpaid invoice gives the use back.

### Endpoints
| Endpoint | Who | Notes |
|---|---|---|
| `GET /billing/preview?asOf` | staff | due subscriptions + rough total (before discounts) |
| `POST /billing/run` `{asOf?, autoConfirm?, subscriptionId?}` `?wait=true` | admin | 202 + run to poll; `wait=true` blocks; 409 `RUN_IN_PROGRESS` if another is live |
| `GET /billing/runs`, `GET /billing/runs/:id` | staff | counters, errors per subscription, invoiced total |
| `GET /invoices` (status, customerId, subscriptionId, billingRunId, search, from/to, overdue, sort) | staff all; customer own **issued** invoices | totals over the whole filtered set |
| `GET /invoices/:id` | same scope (404 otherwise) | lines, discounts, payments, `availableActions` |
| `POST /invoices/:id/confirm` · `/cancel {reason}` · `/send` | staff | confirm numbers it; cancel only while nothing is paid; send emails `billToEmail` |
| `POST /invoices/bulk-confirm {ids \| billingRunId}` | staff | up to 500 per call, each in its own transaction |
| `POST /invoices/:id/reissue` | admin | rebuilds a cancelled period (current lines/prices/discounts) |
| `GET /invoices/:id/print` | staff, or the owner | print-ready HTML (escaped); fetch with the bearer token and print/save as PDF |
| `POST /invoices/:id/payments` `{method, amount, paidAt?, reference?, note?}` + header `Idempotency-Key` | staff | 201 new, 200 replay of the same key |
| `GET /invoices/:id/payments` | staff, or the owner | |

Error codes (409 unless noted): `RUN_IN_PROGRESS`, `INVALID_TRANSITION`, `NOT_CONFIRMED`, `HAS_PAYMENTS`, `PERIOD_ALREADY_INVOICED`, `ALREADY_PAID`, `OVERPAYMENT` (`details.balance`), `IDEMPOTENCY_KEY_REUSED`; `MAIL_FAILED` is 502.

### Payments rules
- Only CONFIRMED invoices take payments; amount > 0, 2 decimals, never more than the balance; date not in the future and not before the invoice was issued.
- The invoice row is locked for the whole transaction, so concurrent payments are serialised (two payments of 70 against 118: one wins; ten that exactly settle all land). The database also rejects `amountPaid > total`.
- A fully paid invoice flips to PAID; a receipt email goes to the customer (best effort, never blocks the payment).
- **Out of scope (by design for now):** refunds/voiding a payment, credit notes, proration, online payment gateways, binary PDFs.

### Operating it
- Set `BILLING_SCHEDULER=true` on the API instance(s) that should bill (safe on several: a DB unique index lets only one scheduler run per day). It runs at/after `BILLING_RUN_HOUR_UTC`, closes auto-closing expired subscriptions first, then bills.
- `BILLING_AUTO_CONFIRM=false` (default) leaves drafts for review; `true` numbers them immediately. `BILLING_CONCURRENCY` (1-8) = parallel invoices; keep it under the DB pool size (10).
- A run stuck RUNNING for 30 min is treated as crashed and no longer blocks new runs. A run is capped at 5,000 invoices; the rest is picked up next run.
- Measured at 170 ms per DB query (remote): ~8 round trips per invoice → 0.7 invoices/s with 1 worker, 3.7/s with 8. With the API next to the database (1-5 ms), expect on the order of 100+ invoices/s.

## Frontend for Packages 6 and 7

| Area | Routes | Notes |
|---|---|---|
| Billing | `/billing` (admin + staff; only admins can run) | "what is due" preview, start a run (date, confirm-now option), live progress, run history, per-run detail with problems and a link to review its drafts |
| Invoices (staff) | `/invoices`, `/invoices/:id` | views (drafts, awaiting payment, overdue, paid, cancelled), search, filter by billing run / customer in the URL; select drafts and confirm in bulk; detail page with confirm, cancel (reason), send, print, reissue (admin), record payment |
| Payments | `/payments` | the payments report (same data as Reports → Payments); recording happens on the invoice |
| Customer portal | `/my/invoices`, `/my/invoices/:id` | their own issued invoices (never drafts), balances, payments, print; no staff actions |
| Links | subscription page → its latest invoices; customer page → "View invoices"; dashboard → "N drafts waiting for review" | |

Notes for whoever extends it:
- The **record payment** dialog creates one `Idempotency-Key` per opening, so pressing Record twice (or retrying after a timeout) can only ever create one payment.
- **Print** fetches the escaped HTML with the bearer token (`fetchText` in `lib/api.ts`) and writes it into a new tab: the tab is opened inside the click because browsers block pop-ups opened after an `await`.
- Money maths is never done in the browser for invoices: it only displays what the API computed (the subscription line editor has a preview, invoices don't).

## Implemented: Packages 1, 2 and 5 (catalog, plans & templates, discounts)

Reviewed and hardened after the first delivery. Tests: `src/test/masterdata.int.test.ts` (34 HTTP tests incl. an end-to-end "create a discount via the API → billing applies it → report → cancel releases it"), `src/lib/schemas.test.ts`, `discounts/derive.test.ts`.

### Endpoints (all under `/api/v1`; **staff read, admin write**)
| Resource | Endpoints |
|---|---|
| Taxes | `GET/POST /taxes`, `GET/PATCH/DELETE /taxes/:id` |
| Products | `GET/POST /products`, `GET/PATCH/DELETE /products/:id`, variants: `GET/POST /products/:id/variants`, `PATCH/DELETE /products/:id/variants/:variantId` |
| Payment terms | `GET/POST /payment-terms`, `GET/PATCH/DELETE /payment-terms/:id` (one default at a time) |
| Plans | `GET/POST /plans`, `GET/PATCH/DELETE /plans/:id` |
| Quotation templates | `GET/POST /quotation-templates`, `GET/PATCH/DELETE /quotation-templates/:id` (`lines` on PATCH replaces them all) |
| Discounts | `GET/POST /discounts` (`?status=active\|scheduled\|expired\|exhausted\|inactive`), `GET/PATCH/DELETE /discounts/:id`, `POST /discounts/:id/products`, `DELETE /discounts/:id/products/:productId`, `POST /discounts/:id/subscriptions`, `DELETE /discounts/:id/subscriptions/:subscriptionId`, `GET /discounts/for-subscription/:subscriptionId`, `GET /discounts/:id/redemptions` |

### Rules worth knowing
- Money is always a 2-decimal **string** in responses (`"1000.00"`); requests accept string or number, max 10 integer digits, max 2 decimals. Percentages 0-100. Dates `YYYY-MM-DD`, validated as real calendar dates.
- **Delete = soft delete, and refused while something live depends on it** (409 `IN_USE`, with counts in `details`): a tax used by products/subscription lines, a product used by live subscriptions/templates/discounts, a plan used by live subscriptions or templates, a payment term used by any subscription, a variant ever sold. The fix offered is *deactivate*: it stops new sales and keeps existing subscriptions billing.
- **A plan's billing cycle (period / interval) is locked while ACTIVE or PAUSED subscriptions bill on it** (409 `PLAN_IN_USE`); everything else on a plan can change at any time.
- Names are unique among live rows, case-insensitively (taxes, products, plans). A deactivated tax can't be assigned to a product (`TAX_UNAVAILABLE`).
- Templates validate every line in one batch (live, active product; active variant that belongs to it) and report `usable` + `problems[]` (retired plan, deactivated product…) so a broken template is visible before someone tries to quote from it. Line order = array order.
- Discount `status` is derived (never stored): inactive / scheduled / active / expired / exhausted. `usageLimit` can't be set below `usedCount` (`USAGE_BELOW_USED`); scope can't change under existing attachments (`SCOPE_CHANGE_BLOCKED`); an active product discount always keeps at least one product (`LAST_PRODUCT`).
- **Discounts are *calculated and redeemed* only by the billing engine** (`billing/calc.ts`). This module never touches `usedCount`. (The first delivery contained a second, subtly different calculator and redeemer: removed so there is one source of truth.)

### What the review found and fixed
1. **None of the three modules were mounted**: every route 404'd. Now mounted explicitly in `app.ts`, each router authenticating itself (the old aggregator routers applied `authenticate` to everything beneath their mount point, which would have put a login wall in front of `/auth/login` if mounted at the root).
2. **500s from the database** that should be clean 4xx: deleting an in-use payment term or variant (FK), amounts/percentages beyond `NUMERIC`/`CHECK` limits, `usageLimit` below `usedCount`, percentage over 100 after changing `type`, `null` silently coerced to `0` by `z.coerce`. Strict shared schemas in `lib/schemas.ts`; a global backstop maps Prisma `P2003` → 409 and `P2000/P2020` → 400.
3. **Duplicate, divergent pricing code** in discounts (no stacking cap, no rounding, different minimum-purchase rule). Removed.
4. **Template line order bug**: `sortOrder` defaulted to 0 in the schema so every line got 0 and order was undefined. Order now comes from the array.
5. **Money serialised as raw Decimals** (`"1000"`), inconsistent with the rest of the API. DTOs now format it.
6. **N+1 / chatty reads**: template validation did 2 queries per line; list/detail reads did one query per relation. Now batched and loaded with a single JOINed query (`relationLoadStrategy: "join"`): ~1 round trip instead of 3-5, which matters on a remote database.
7. **Silent business breakage**: changing a live plan's billing cycle, deleting things in use, templates pointing at retired plans/products (see rules above).
8. **Tax name uniqueness** blocked re-use after a soft delete and was case-sensitive: migration `20260104000000_tax_name_live_unique`.
9. Stable pagination (id tie-break), empty PATCH bodies rejected, audit metadata trimmed to what changed, `GET`s open to staff (discounts were admin-only for reads), staff can see which discounts apply to a subscription.

### Decisions you may want to revisit
- Staff can read discounts but **only admins attach them to subscriptions** (the brief says only the admin creates discount rules; applying them is stricter than required). Loosen `POST/DELETE /discounts/:id/subscriptions` to `requireStaff` if sales reps should do it.
- Deactivating a tax keeps charging it on products/lines that already use it (it only stops being *offered*). Move products to a new tax first if the old one should stop applying.

## Frontend for packages 1, 2 and 5

Screens (staff read, admin write; writes are hidden for staff and enforced by the API):

| Route | Feature folder | Notes |
|---|---|---|
| `/taxes`, `/payment-terms` | `frontend/features/catalog` | list plus modal forms; deletes show the API's `IN_USE` message inline |
| `/products`, `/products/[id]` | `frontend/features/catalog` | variants are managed on the product page |
| `/plans` | `frontend/features/plans` | billing cycle fields lock while `liveSubscriptions > 0` |
| `/quotation-templates`, `/new`, `/[id]` | `frontend/features/templates` | lines editor, shows `usable` and `problems` |
| `/discounts`, `/discounts/[id]` | `frontend/features/discounts` | status chips, product detach, redemptions table |

Wiring: any catalog change invalidates the `/subscriptions/options` cache; the subscription page has a Discounts card
(admin attaches or detaches subscription-scoped discounts); the staff dashboard shows a setup checklist until a payment
term, product and plan exist; the subscription form links to Plans/Products when they are missing.
