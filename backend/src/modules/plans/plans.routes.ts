import { Router } from "express";
import { z } from "zod";
import { audit } from "../../lib/audit.js";
import { idParam } from "../../lib/shared.js";
import { authenticate, requireRole, requireStaff } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  createPlanSchema,
  updatePlanSchema,
  listPlansQuery,
  createQuotationTemplateSchema,
  updateQuotationTemplateSchema,
  listQuotationTemplatesQuery,
} from "./plans.schemas.js";
import * as svc from "./plans.service.js";

export const plansModuleRouter = Router();

// Base auth requirement: all endpoints require authentication
plansModuleRouter.use(authenticate);

// ==========================================
// 1. PLANS (/plans)
// Access: Staff/Admin read; Admin write
// ==========================================

const planRouter = Router();

planRouter.get("/", requireStaff, validate({ query: listPlansQuery }), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof listPlansQuery>;
  const result = await svc.listPlans(query);
  res.json(result);
});

planRouter.get("/:id", requireStaff, validate({ params: idParam }), async (req, res) => {
  const plan = await svc.getPlanById(req.params.id as string);
  res.json({ plan });
});

planRouter.post("/", requireRole("ADMIN"), validate({ body: createPlanSchema }), async (req, res) => {
  const plan = await svc.createPlan(req.body);
  await audit(req, { action: "plan.create", entityType: "Plan", entityId: plan.id, metadata: req.body });
  res.status(201).json({ plan });
});

planRouter.patch("/:id", requireRole("ADMIN"), validate({ params: idParam, body: updatePlanSchema }), async (req, res) => {
  const id = req.params.id as string;
  const plan = await svc.updatePlan(id, req.body);
  await audit(req, { action: "plan.update", entityType: "Plan", entityId: id, metadata: req.body });
  res.json({ plan });
});

planRouter.delete("/:id", requireRole("ADMIN"), validate({ params: idParam }), async (req, res) => {
  const id = req.params.id as string;
  await svc.softDeletePlan(id);
  await audit(req, { action: "plan.delete", entityType: "Plan", entityId: id });
  res.status(204).end();
});

// ==========================================
// 2. QUOTATION TEMPLATES (/quotation-templates)
// Access: Staff/Admin read; Admin write
// ==========================================

const quotationTemplateRouter = Router();

quotationTemplateRouter.get("/", requireStaff, validate({ query: listQuotationTemplatesQuery }), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof listQuotationTemplatesQuery>;
  const result = await svc.listQuotationTemplates(query);
  res.json(result);
});

quotationTemplateRouter.get("/:id", requireStaff, validate({ params: idParam }), async (req, res) => {
  const template = await svc.getQuotationTemplateById(req.params.id as string);
  res.json({ template });
});

quotationTemplateRouter.post("/", requireRole("ADMIN"), validate({ body: createQuotationTemplateSchema }), async (req, res) => {
  const template = await svc.createQuotationTemplate(req.body);
  await audit(req, {
    action: "quotation_template.create",
    entityType: "QuotationTemplate",
    entityId: template.id,
    metadata: { name: req.body.name, planId: req.body.planId },
  });
  res.status(201).json({ template });
});

quotationTemplateRouter.patch("/:id", requireRole("ADMIN"), validate({ params: idParam, body: updateQuotationTemplateSchema }), async (req, res) => {
  const id = req.params.id as string;
  const template = await svc.updateQuotationTemplate(id, req.body);
  await audit(req, {
    action: "quotation_template.update",
    entityType: "QuotationTemplate",
    entityId: id,
    metadata: { name: req.body.name, planId: req.body.planId },
  });
  res.json({ template });
});

quotationTemplateRouter.delete("/:id", requireRole("ADMIN"), validate({ params: idParam }), async (req, res) => {
  const id = req.params.id as string;
  await svc.softDeleteQuotationTemplate(id);
  await audit(req, { action: "quotation_template.delete", entityType: "QuotationTemplate", entityId: id });
  res.status(204).end();
});

export { planRouter, quotationTemplateRouter };

plansModuleRouter.use("/plans", planRouter);
plansModuleRouter.use("/quotation-templates", quotationTemplateRouter);
