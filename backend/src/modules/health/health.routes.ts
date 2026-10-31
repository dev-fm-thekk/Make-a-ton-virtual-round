import { Router } from "express";
import { prisma } from "../../lib/prisma.js";

export const healthRouter = Router();

// Liveness: process is up. Never touches dependencies.
healthRouter.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

// Readiness: can we actually serve? Used by the load balancer / orchestrator.
healthRouter.get("/readyz", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});
