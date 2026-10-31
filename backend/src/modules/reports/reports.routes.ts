import { Router } from "express";
import { authenticate, requireStaff } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  invoicesQuery,
  overdueQuery,
  paymentsQuery,
  revenueQuery,
  subscriptionsReportQuery,
  summaryQuery,
  type InvoicesQuery,
  type OverdueQuery,
  type PaymentsQuery,
  type RevenueQuery,
  type SubscriptionsReportQuery,
  type SummaryQuery,
} from "./reports.schemas.js";
import * as svc from "./reports.service.js";

export const reportsRouter = Router();

// Finance data: ADMIN + STAFF only. Customers see their own invoices through the invoices module.
reportsRouter.use(authenticate, requireStaff);
// Numbers change every minute and are private: never let a shared cache keep them.
reportsRouter.use((_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});

reportsRouter.get("/summary", validate({ query: summaryQuery }), async (req, res) => {
  res.json(await svc.summary(req.query as unknown as SummaryQuery));
});

reportsRouter.get("/revenue", validate({ query: revenueQuery }), async (req, res) => {
  res.json(await svc.revenueSeries(req.query as unknown as RevenueQuery));
});

reportsRouter.get("/overdue", validate({ query: overdueQuery }), async (req, res) => {
  res.json(await svc.overdue(req.query as unknown as OverdueQuery));
});

reportsRouter.get("/invoices", validate({ query: invoicesQuery }), async (req, res) => {
  res.json(await svc.invoices(req.query as unknown as InvoicesQuery));
});

reportsRouter.get("/payments", validate({ query: paymentsQuery }), async (req, res) => {
  res.json(await svc.payments(req.query as unknown as PaymentsQuery));
});

reportsRouter.get("/subscriptions", validate({ query: subscriptionsReportQuery }), async (req, res) => {
  res.json(await svc.subscriptionsReport(req.query as unknown as SubscriptionsReportQuery));
});
