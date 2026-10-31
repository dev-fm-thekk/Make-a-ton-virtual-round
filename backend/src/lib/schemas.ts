// Request-validation building blocks shared by every module, so "what is a valid amount / percentage / date" is
// decided once. They are deliberately strict: the database has hard limits (NUMERIC(12,2), int4, CHECK constraints)
// and a request that would hit one must be rejected as a clean 400 here, never surface as a 500 from Postgres.

import { z } from "zod";

const asString = z.union([z.string().trim(), z.number()]).transform((v) => String(v));

/** A non-negative amount with at most 2 decimals and at most 10 integer digits (fits NUMERIC(12,2)). */
export const moneyInput = asString.refine((v) => /^\d{1,10}(\.\d{1,2})?$/.test(v), "Use a non-negative amount with at most 2 decimals");

/** Same, but strictly greater than zero. */
export const positiveMoneyInput = moneyInput.refine((v) => Number(v) > 0, "Must be greater than zero");

/** A percentage from 0 to 100 with at most 2 decimals. */
export const percentInput = asString.refine((v) => /^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) <= 100, "Use a percentage from 0 to 100 with at most 2 decimals");

/** A plain integer within [min, max]. No string coercion: `null` or "" must not silently become 0. */
export const boundedInt = (min: number, max: number) => z.number().int().min(min).max(max);

/** PATCH bodies must change something. */
export const hasAnyField = (o: object) => Object.values(o).some((v) => v !== undefined);
export const ANY_FIELD_MESSAGE = "Provide at least one field to update";

/** Query-string boolean: "true" / "false" only. */
export const queryBool = z
  .enum(["true", "false"])
  .transform((v) => v === "true")
  .optional();

export const uuid = z.string().uuid();
