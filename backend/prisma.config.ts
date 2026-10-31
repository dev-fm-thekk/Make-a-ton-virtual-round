import { defineConfig } from "prisma/config";

// Prisma 7: connection URLs live here, not in schema.prisma.
// `prisma migrate` uses DIRECT_URL (a session connection – required for DDL, and the
// only thing that works through Supabase's transaction pooler). Falls back to DATABASE_URL locally.
// Env is loaded by `node --env-file` / tsx --env-file (see package.json scripts), so
// generate/validate work in CI without a database.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
