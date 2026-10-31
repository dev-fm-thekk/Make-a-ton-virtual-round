import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";

export const idParam = z.object({ id: z.string().uuid() });

/** Standard list query: ?page=1&limit=25 (limit capped at 100). */
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type Pagination = z.infer<typeof paginationQuery>;

export const pageArgs = ({ page, limit }: Pagination) => ({ skip: (page - 1) * limit, take: limit });

export const pageResult = <T>(items: T[], total: number, { page, limit }: Pagination) => ({
  items,
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});

/** Accepts either the global client or an interactive-transaction client. */
export type Tx = Prisma.TransactionClient;

/**
 * Concurrency-safe human numbers: nextDocumentNumber(tx, "INV") → "INV-2026-000042".
 * Single atomic upsert-increment; call it INSIDE the transaction that creates the document.
 */
export async function nextDocumentNumber(tx: Tx, prefix: "SUB" | "INV", date = new Date()): Promise<string> {
  const year = date.getUTCFullYear();
  const key = `${prefix}-${year}`;
  const rows = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "document_sequences" ("key", "lastValue", "updatedAt")
    VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET "lastValue" = "document_sequences"."lastValue" + 1, "updatedAt" = now()
    RETURNING "lastValue"`;
  return `${key}-${String(rows[0]!.lastValue).padStart(6, "0")}`;
}
