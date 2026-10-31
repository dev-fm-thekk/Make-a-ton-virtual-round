import { Router } from "express";
import { z } from "zod";
import { todayUtc } from "../../lib/dates.js";
import { idParam } from "../../lib/shared.js";
import { authenticate, requireRole, requireStaff } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  createSubscriptionSchema,
  listSubscriptionsQuery,
  replaceLinesSchema,
  transitionSchema,
  updateSubscriptionSchema,
  type ListSubscriptionsQuery,
} from "./subscriptions.schemas.js";
import * as svc from "./subscriptions.service.js";

export const subscriptionsRouter = Router();
subscriptionsRouter.use(authenticate);

// Reads: staff see all, customers only their own (scoped inside the service queries).
subscriptionsRouter.get("/", validate({ query: listSubscriptionsQuery }), async (req, res) => {
  res.json(await svc.listSubscriptions(req, req.query as unknown as ListSubscriptionsQuery));
});

// Declared before "/:id" so "options" is never parsed as an id.
subscriptionsRouter.get("/options", requireStaff, async (_req, res) => {
  res.json(await svc.formOptions());
});

subscriptionsRouter.get("/:id", validate({ params: idParam }), async (req, res) => {
  res.json({ subscription: await svc.getSubscription(req, req.params.id as string) });
});

// Writes that shape the deal: staff only.
subscriptionsRouter.post("/", requireStaff, validate({ body: createSubscriptionSchema }), async (req, res) => {
  res.status(201).json({ subscription: await svc.createSubscription(req, req.body) });
});

subscriptionsRouter.patch("/:id", requireStaff, validate({ params: idParam, body: updateSubscriptionSchema }), async (req, res) => {
  res.json({ subscription: await svc.updateSubscription(req, req.params.id as string, req.body) });
});

subscriptionsRouter.put("/:id/lines", requireStaff, validate({ params: idParam, body: replaceLinesSchema }), async (req, res) => {
  res.json({ subscription: await svc.replaceLines(req, req.params.id as string, req.body.version, req.body.lines) });
});

// Lifecycle: which roles may do which action is decided by the state machine (customers: accept, pause, resume, close, renew – own only).
subscriptionsRouter.post("/:id/transition", validate({ params: idParam, body: transitionSchema }), async (req, res) => {
  res.json({ subscription: await svc.transition(req, req.params.id as string, req.body) });
});

// Manual trigger for the daily auto-close job (the scheduler calls svc.closeExpiredSubscriptions directly).
subscriptionsRouter.post(
  "/maintenance/close-expired",
  requireRole("ADMIN"),
  validate({ body: z.object({}).optional() }),
  async (_req, res) => {
    res.json({ closed: await svc.closeExpiredSubscriptions(todayUtc()) });
  },
);
