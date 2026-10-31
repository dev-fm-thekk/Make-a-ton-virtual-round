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
| 1 | **Catalog** | Tax, Product, ProductVariant, PaymentTerm | `/taxes`, `/products` (+ `/:id/variants`), `/payment-terms` | Admin write; Staff read | – |
| 2 | **Plans & quotation templates** | Plan, QuotationTemplate(+Line) | `/plans`, `/quotation-templates` | Admin write; Staff read | 1 (reads Product) |
| 3 | **Customers** ✅ | Customer | `/customers` (staff CRUD, search); `/me/profile` (customer edits own) | Staff/Admin; Customer = self | – |
| 4 | **Subscriptions** ✅ | Subscription, SubscriptionLine, SubscriptionStatusHistory | `/subscriptions` CRUD, lines, `POST /:id/transition` (confirm/activate/pause/resume/close/renew), create-from-template; customer portal `GET` of own | Staff/Admin write; Customer read-own | 1, 2, 3 (code against the schema; use seed data) |
| 5 | **Discounts** | Discount, DiscountProduct, SubscriptionDiscount | `/discounts` CRUD (admin only), attach to products / subscriptions | Admin | 1 |
| 6 | **Billing engine & invoices** | BillingRun, Invoice, InvoiceLine, DiscountRedemption | `POST /billing/run`, `/invoices` list/get, `confirm` / `cancel` / `send` / `print` (PDF/HTML), customer portal read-own | Staff/Admin; Customer read-own | 4, 5 (calls their services) |
| 7 | **Payments** | Payment | `POST /invoices/:id/payments` (idempotency key), `GET /payments`, `GET /invoices/:id/payments` | Staff/Admin record; Customer read-own | 6 |
| 8 | **Reporting** ✅ | – (read-only SQL over everything) | `/reports/summary`, `/reports/revenue`, `/reports/overdue`, `/reports/subscriptions` (filters, paging) | Admin/Staff | 4, 6, 7 |
| F | **Frontend** (Next.js, `frontend/`) | – | consumes the API | – | contracts below |

Suggested split for three people: **A** = 1 → 2 → 5, **B** = 3 → 4 → 8, **C** = 6 → 7. Frontend can start immediately on
auth screens + layouts against `/auth/*`, then follow the API as packages land.

### Hard rules inside the heavy packages

**4 Subscriptions** – allowed transitions: `DRAFT→QUOTATION→CONFIRMED→ACTIVE`, `ACTIVE⇄PAUSED` (only if `plan.allowPause`), `ACTIVE|PAUSED→CLOSED` (early close only if `plan.allowEarlyClose`), renewal only if `plan.allowRenewal`. Every transition: check `version` (optimistic lock), write `SubscriptionStatusHistory`, in one tx. Number via `nextDocumentNumber(tx, "SUB")`. On activate, set `nextBillingDate = startDate`; clear it on close. `plan.autoCloseOnEnd` is closed by a daily job (owner: 6's scheduler).

**5 Discounts** – export a pure function `findApplicableDiscounts(lines, subscription, asOf)` that Package 6 calls. Redemption is a guarded update: `UPDATE discounts SET "usedCount"="usedCount"+1 WHERE id=$1 AND ("usageLimit" IS NULL OR "usedCount"<"usageLimit")`; 0 rows → not applied.

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
