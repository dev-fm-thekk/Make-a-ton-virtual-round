import { Router } from "express";
import type { z } from "zod";
import { audit } from "../../lib/audit.js";
import { idParam } from "../../lib/shared.js";
import { authenticate, requireRole, requireStaff } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  createPlanSchema,
  createQuotationTemplateSchema,
  listPlansQuery,
  listQuotationTemplatesQuery,
  updatePlanSchema,
  updateQuotationTemplateSchema,
} from "./plans.schemas.js";
import * as svc from "./plans.service.js";

// Access: staff read, admin write. Each router authenticates itself (see catalog.routes.ts).
const query = <T extends z.ZodType>(req: { query: unknown }) => req.query as z.output<T>;

// ───────── /plans ─────────
export const plansRouter = Router();
plansRouter.use(authenticate);

plansRouter.get("/", requireStaff, validate({ query: listPlansQuery }), async (req, res) => {
  res.json(await svc.listPlans(query<typeof listPlansQuery>(req)));
});
plansRouter.get("/:id", requireStaff, validate({ params: idParam }), async (req, res) => {
  res.json({ plan: await svc.getPlanById(req.params.id as string) });
});
plansRouter.post("/", requireRole("ADMIN"), validate({ body: createPlanSchema }), async (req, res) => {
  const plan = await svc.createPlan(req.body);
  await audit(req, { action: "plan.create", entityType: "Plan", entityId: plan.id, metadata: { name: plan.name, billingPeriod: plan.billingPeriod, billingInterval: plan.billingInterval } });
  res.status(201).json({ plan });
});
plansRouter.patch("/:id", requireRole("ADMIN"), validate({ params: idParam, body: updatePlanSchema }), async (req, res) => {
  const id = req.params.id as string;
  const plan = await svc.updatePlan(id, req.body);
  await audit(req, { action: "plan.update", entityType: "Plan", entityId: id, metadata: req.body });
  res.json({ plan });
});
plansRouter.delete("/:id", requireRole("ADMIN"), validate({ params: idParam }), async (req, res) => {
  const id = req.params.id as string;
  await svc.softDeletePlan(id);
  await audit(req, { action: "plan.delete", entityType: "Plan", entityId: id });
  res.status(204).end();
});

// ───────── /quotation-templates ─────────
export const quotationTemplatesRouter = Router();
quotationTemplatesRouter.use(authenticate);

quotationTemplatesRouter.get("/", requireStaff, validate({ query: listQuotationTemplatesQuery }), async (req, res) => {
  res.json(await svc.listQuotationTemplates(query<typeof listQuotationTemplatesQuery>(req)));
});
quotationTemplatesRouter.get("/:id", requireStaff, validate({ params: idParam }), async (req, res) => {
  res.json({ template: await svc.getQuotationTemplateById(req.params.id as string) });
});
quotationTemplatesRouter.post("/", requireRole("ADMIN"), validate({ body: createQuotationTemplateSchema }), async (req, res) => {
  const template = await svc.createQuotationTemplate(req.body);
  await audit(req, { action: "quotation_template.create", entityType: "QuotationTemplate", entityId: template.id, metadata: { name: template.name, planId: template.planId, lines: template.lines.length } });
  res.status(201).json({ template });
});
quotationTemplatesRouter.patch("/:id", requireRole("ADMIN"), validate({ params: idParam, body: updateQuotationTemplateSchema }), async (req, res) => {
  const id = req.params.id as string;
  const template = await svc.updateQuotationTemplate(id, req.body);
  await audit(req, { action: "quotation_template.update", entityType: "QuotationTemplate", entityId: id, metadata: { fields: Object.keys(req.body) } });
  res.json({ template });
});
quotationTemplatesRouter.delete("/:id", requireRole("ADMIN"), validate({ params: idParam }), async (req, res) => {
  const id = req.params.id as string;
  await svc.softDeleteQuotationTemplate(id);
  await audit(req, { action: "quotation_template.delete", entityType: "QuotationTemplate", entityId: id });
  res.status(204).end();
});
