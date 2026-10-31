import { z } from "zod";
import { passwordSchema } from "../../lib/security.js";

const email = z.string().trim().toLowerCase().email().max(254);

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email,
  password: passwordSchema,
  companyName: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(40).optional(),
});

export const loginSchema = z.object({ email, password: z.string().min(1).max(128) });

/** Browsers send the refresh token as an httpOnly cookie; API clients may send it in the body. */
export const refreshSchema = z.object({ refreshToken: z.string().min(1).optional() });

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
