import { z } from "zod";

// Mirrors the API's policy (backend/src/lib/security.ts). The server is still the authority.
export const PASSWORD_RULES = [
  { id: "len", label: "More than 8 characters", test: (p: string) => p.length >= 9 },
  { id: "upper", label: "An uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { id: "lower", label: "A lowercase letter", test: (p: string) => /[a-z]/.test(p) },
  { id: "special", label: "A special character", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
] as const;

export const passwordSchema = z
  .string()
  .min(9, "Password must be more than 8 characters")
  .regex(/[A-Z]/, "Add an uppercase letter")
  .regex(/[a-z]/, "Add a lowercase letter")
  .regex(/[^A-Za-z0-9]/, "Add a special character");

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address");
