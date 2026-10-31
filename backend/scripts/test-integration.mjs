// Runs the DB integration suite. Usage: npm run test:integration
// Needs a reachable DATABASE_URL in .env; creates and then deletes rows tagged `zzt…`.
import { startVitest } from "vitest/node";

process.env.ALLOW_DB_TESTS = "1";
process.env.LOG_LEVEL = "silent"; // keep test output readable
const vitest = await startVitest("test", process.argv.slice(2), { config: "vitest.integration.config.ts", run: true, watch: false });
const failed = (vitest?.state.getCountOfFailedTests() ?? 1) > 0;
await vitest?.close();
process.exit(failed ? 1 : 0);
