// Idempotent bootstrap data. Safe to run on every deploy:  npm run db:seed
//  * first ADMIN (from ADMIN_EMAIL / ADMIN_PASSWORD) – admins can't self-register
//  * standard payment terms
import { z } from "zod";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword, passwordSchema } from "../src/lib/security.js";

const creds = z
  .object({ ADMIN_EMAIL: z.string().trim().toLowerCase().email(), ADMIN_PASSWORD: passwordSchema, ADMIN_NAME: z.string().default("Administrator") })
  .parse(process.env);

const existing = await prisma.user.findUnique({ where: { email: creds.ADMIN_EMAIL } });
if (existing) {
  console.log(`admin ${creds.ADMIN_EMAIL} already exists – left unchanged`);
} else {
  await prisma.user.create({
    data: { email: creds.ADMIN_EMAIL, name: creds.ADMIN_NAME, passwordHash: await hashPassword(creds.ADMIN_PASSWORD), role: "ADMIN" },
  });
  console.log(`created admin ${creds.ADMIN_EMAIL}`);
}

const terms = [
  { name: "Due on receipt", dueDays: 0, isDefault: false },
  { name: "Net 15", dueDays: 15, isDefault: true },
  { name: "Net 30", dueDays: 30, isDefault: false },
  { name: "Net 60", dueDays: 60, isDefault: false },
];
for (const t of terms) {
  await prisma.paymentTerm.upsert({ where: { name: t.name }, update: {}, create: t });
}
console.log(`payment terms ensured (${terms.length})`);

await prisma.$disconnect();
