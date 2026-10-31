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
| 3 | **Customers** | Customer | `/customers` (staff CRUD, search); `/me/profile` (customer edits own) | Staff/Admin; Customer = self | – |
| 4 | **Subscriptions** | Subscription, SubscriptionLine, SubscriptionStatusHistory | `/subscriptions` CRUD, lines, `POST /:id/transition` (confirm/activate/pause/resume/close/renew), create-from-template; customer portal `GET` of own | Staff/Admin write; Customer read-own | 1, 2, 3 (code against the schema; use seed data) |
| 5 | **Discounts** | Discount, DiscountProduct, SubscriptionDiscount | `/discounts` CRUD (admin only), attach to products / subscriptions | Admin | 1 |
| 6 | **Billing engine & invoices** | BillingRun, Invoice, InvoiceLine, DiscountRedemption | `POST /billing/run`, `/invoices` list/get, `confirm` / `cancel` / `send` / `print` (PDF/HTML), customer portal read-own | Staff/Admin; Customer read-own | 4, 5 (calls their services) |
| 7 | **Payments** | Payment | `POST /invoices/:id/payments` (idempotency key), `GET /payments`, `GET /invoices/:id/payments` | Staff/Admin record; Customer read-own | 6 |
| 8 | **Reporting** | – (read-only SQL over everything) | `/reports/summary`, `/reports/revenue`, `/reports/overdue`, `/reports/subscriptions` (filters, paging) | Admin/Staff | 4, 6, 7 |
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
