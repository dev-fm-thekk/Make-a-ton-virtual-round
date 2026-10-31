import { Router } from "express";
import { badRequest } from "../../lib/errors.js";
import { idParam } from "../../lib/shared.js";
import { authenticate, requireStaff } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { idempotencyKeyHeader, recordPaymentBody } from "./payments.schemas.js";
import * as svc from "./payments.service.js";

/** Mounted under /invoices: POST|GET /invoices/:id/payments */
export const paymentsRouter = Router();
paymentsRouter.use(authenticate);

// Reads: staff, or a customer for their own invoice.
paymentsRouter.get("/:id/payments", validate({ params: idParam }), async (req, res) => {
  res.json(await svc.listForInvoice(req, req.params.id as string));
});

// Recording money is staff-only. Send `Idempotency-Key: <uuid>` so a retry (timeout, double-click) can never pay twice.
paymentsRouter.post("/:id/payments", requireStaff, validate({ params: idParam, body: recordPaymentBody }), async (req, res) => {
  const raw = req.get("idempotency-key");
  let key: string | undefined;
  if (raw !== undefined) {
    const parsed = idempotencyKeyHeader.safeParse(raw);
    if (!parsed.success) throw badRequest("Invalid Idempotency-Key header", { reason: parsed.error.issues[0]?.message });
    key = parsed.data;
  }
  const result = await svc.recordPayment(req, req.params.id as string, req.body, key);
  res.status(result.replayed ? 200 : 201).json(result);
});
