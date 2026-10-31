import { Router } from "express";
import { idParam } from "../../lib/shared.js";
import { authenticate, requireRole, requireStaff } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { bulkConfirmBody, cancelBody, listInvoicesQuery, type ListInvoicesQuery } from "./invoices.schemas.js";
import * as svc from "./invoices.service.js";

export const invoicesRouter = Router();
invoicesRouter.use(authenticate);

// Reads: staff see everything; customers only their own issued invoices (scoped in the query).
invoicesRouter.get("/", validate({ query: listInvoicesQuery }), async (req, res) => {
  res.json(await svc.listInvoices(req, req.query as unknown as ListInvoicesQuery));
});

// Declared before "/:id" so "bulk-confirm" is never read as an id.
invoicesRouter.post("/bulk-confirm", requireStaff, validate({ body: bulkConfirmBody }), async (req, res) => {
  res.json(await svc.bulkConfirm(req, req.body));
});

invoicesRouter.get("/:id", validate({ params: idParam }), async (req, res) => {
  res.json({ invoice: await svc.getInvoice(req, req.params.id as string) });
});

// Print-ready HTML. The frontend fetches it with the bearer token and opens it for printing / saving as PDF.
invoicesRouter.get("/:id/print", validate({ params: idParam }), async (req, res) => {
  const html = await svc.printHtml(req, req.params.id as string);
  res.type("html").set("Cache-Control", "private, no-store").send(html);
});

invoicesRouter.post("/:id/confirm", requireStaff, validate({ params: idParam }), async (req, res) => {
  res.json(await svc.confirm(req, req.params.id as string));
});

invoicesRouter.post("/:id/cancel", requireStaff, validate({ params: idParam, body: cancelBody }), async (req, res) => {
  res.json(await svc.cancel(req, req.params.id as string, req.body.reason));
});

invoicesRouter.post("/:id/send", requireStaff, validate({ params: idParam }), async (req, res) => {
  res.json(await svc.send(req, req.params.id as string));
});

invoicesRouter.post("/:id/reissue", requireRole("ADMIN"), validate({ params: idParam }), async (req, res) => {
  res.status(201).json(await svc.reissue(req, req.params.id as string));
});
