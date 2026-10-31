import pino from "pino";
import { env, isProd } from "../config/env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.passwordHash", "*.token", "*.refreshToken"],
    censor: "[redacted]",
  },
  ...(isProd ? {} : { transport: { target: "pino-pretty", options: { colorize: true } } }),
});
