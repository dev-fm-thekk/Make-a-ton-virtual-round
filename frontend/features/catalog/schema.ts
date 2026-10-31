import { z } from "zod";

/** Mirrors the API's moneyInput: non-negative, at most 2 decimals, fits NUMERIC(12,2). */
export const moneyText = (label = "an amount") =>
  z
    .string()
    .trim()
    .min(1, `Enter ${label}`)
    .regex(/^\d{1,10}(\.\d{1,2})?$/, "Use a number with up to 2 decimals");

export const percentText = z
  .string()
  .trim()
  .min(1, "Enter a rate")
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "Use a number with up to 2 decimals")
  .refine((v) => Number(v) <= 100, "Cannot exceed 100");
