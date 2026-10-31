import { defineConfig } from "vitest/config";

// Unit tests only (pure logic, no database). DB tests live in *.int.test.ts → `npm run test:integration`.
export default defineConfig({ test: { include: ["src/**/*.test.ts"], exclude: ["**/*.int.test.ts", "node_modules"], environment: "node" } });
