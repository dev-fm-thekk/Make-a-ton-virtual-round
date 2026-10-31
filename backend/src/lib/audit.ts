import type { Request } from "express";
import { logger } from "./logger.js";
import { prisma } from "./prisma.js";
import type { Tx } from "./shared.js";

interface AuditInput {
  action: string; // "invoice.confirm"
  entityType: string; // "Invoice"
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Append an audit row. Pass `tx` to make it atomic with the business change (preferred for
 * money/state changes). Audit failures never break a request when run standalone.
 */
export async function audit(req: Request, input: AuditInput, tx?: Tx): Promise<void> {
  const data = {
    actorId: req.auth?.userId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata as object | undefined,
    ip: req.ip,
    requestId: String(req.id ?? ""),
  };
  if (tx) {
    await tx.auditLog.create({ data });
    return;
  }
  await prisma.auditLog.create({ data }).catch((err) => logger.error({ err }, "audit write failed"));
}
