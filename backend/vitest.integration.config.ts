import { defineConfig } from "vitest/config";

// Integration tests talk to the REAL database in .env (npm run test:integration refuses to start
// without ALLOW_DB_TESTS=1). Every row they create is tagged `zzt…` and removed afterwards.
export default defineConfig({
  test: {
    include: ["src/**/*.int.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
