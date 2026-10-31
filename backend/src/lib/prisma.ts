import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env.js";
import { PrismaClient } from "../generated/prisma/client.js";

// Runtime traffic goes through DATABASE_URL (Supabase transaction pooler in prod, plain
// Postgres locally). Migrations use DIRECT_URL via prisma.config.ts.
// `max` is per-process; size it so  (instances × max)  stays below the pooler's limit.
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const prisma = new PrismaClient({ adapter });

export type { Prisma } from "../generated/prisma/client.js";
