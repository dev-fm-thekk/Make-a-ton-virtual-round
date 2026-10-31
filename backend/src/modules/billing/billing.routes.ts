import { Router } from "express";
import { z } from "zod";
import { audit } from "../../lib/audit.js";
import { dateOnly } from "../../lib/dates.js";
import { ANY_FIELD_MESSAGE, boundedInt, hasAnyField } from "../../lib/schemas.js";
import { idParam, paginationQuery } from "../../lib/shared.js";
import { auth, authenticate, requireRole, requireStaff } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import * as svc from "./billing.service.js";
import { describeSettings, updateSettings } from "./settings.service.js";

export const billingRouter = Router();
billingRouter.use(authenticate, requireStaff);
billingRouter.use((_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});

billingRouter.get("/preview", validate({ query: z.object({ asOf: dateOnly.optional() }) }), async (req, res) => {
  res.json(await svc.preview((req.query as { asOf?: Date }).asOf));
});

const runBody = z.object({
  /** Bill everything due up to this date (default today; never the future). */
  asOf: dateOnly.optional(),
  /** Confirm (number) the invoices immediately instead of leaving drafts. */
  autoConfirm: z.boolean().optional(),
  /** Bill just this subscription. */
  subscriptionId: z.string().uuid().optional(),
});

// Mass-producing invoices is an admin decision.
// Returns 202 immediately with the run to poll; add ?wait=true to hold the request until it finishes (small runs, scripts, tests).
billingRouter.post(
  "/run",
  requireRole("ADMIN"),
  validate({ body: runBody, query: z.object({ wait: z.enum(["true", "false"]).default("false") }) }),
  async (req, res) => {
    const params: svc.StartParams = { triggeredBy: auth(req).userId, asOf: req.body.asOf, autoConfirm: req.body.autoConfirm ?? false, subscriptionId: req.body.subscriptionId };
    const run = await svc.createRun(params);
    if (!run) throw new Error("unreachable: only the scheduler can lose the claim");
    await audit(req, { action: "billing.run", entityType: "BillingRun", entityId: run.id, metadata: { asOf: req.body.asOf, subscriptionId: req.body.subscriptionId } });

    const work = svc.runInBackground(run, params);
    if ((req.query as { wait?: string }).wait === "true") {
      await work;
      res.json({ run: await svc.getRun(run.id) });
      return;
    }
    void work;
    res.status(202).json({ run: await svc.getRun(run.id) });
  },
);

// ───────── scheduler settings ─────────
billingRouter.get("/settings", async (_req, res) => {
  res.json({ settings: await describeSettings() });
});

const settingsBody = z
  .object({ schedulerEnabled: z.boolean(), runHourUtc: boundedInt(0, 23), autoConfirm: z.boolean() })
  .partial()
  .refine(hasAnyField, ANY_FIELD_MESSAGE);

billingRouter.patch("/settings", requireRole("ADMIN"), validate({ body: settingsBody }), async (req, res) => {
  await updateSettings(req.body, auth(req).userId);
  await audit(req, { action: "billing.settings", entityType: "BillingSettings", entityId: "1", metadata: req.body });
  res.json({ settings: await describeSettings() });
});

billingRouter.get("/runs", validate({ query: paginationQuery }), async (req, res) => {
  res.json(await svc.listRuns(req.query as never));
});

billingRouter.get("/runs/:id", validate({ params: idParam }), async (req, res) => {
  res.json({ run: await svc.getRun(req.params.id as string) });
});
