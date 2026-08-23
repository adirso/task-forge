import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
dotenv.config({ path: path.join(repoRoot, ".env") });

export const config = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "127.0.0.1",
  databasePath: path.resolve(repoRoot, process.env.DATABASE_PATH ?? "data/taskforge.db"),
  attachmentsPath: path.resolve(repoRoot, process.env.ATTACHMENTS_PATH ?? "data/attachments"),
  databaseDriver: (process.env.DATABASE_DRIVER ?? (process.env.DATABASE_URL ? "mysql" : "sqlite")) as "sqlite" | "mysql",
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET ?? "development-only-change-me-taskforge-secret",
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? process.env.JWT_SECRET ?? "development-only-change-me-taskforge-secret",
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  isProduction: process.env.NODE_ENV === "production",
  trustedProxy: process.env.TRUST_PROXY === "true" ? true : (process.env.TRUST_PROXY ? process.env.TRUST_PROXY.split(",").map((value) => value.trim()).filter(Boolean) : false),
  loginRateLimitIp: Number(process.env.LOGIN_RATE_LIMIT_IP ?? 20),
  loginRateLimitAccount: Number(process.env.LOGIN_RATE_LIMIT_ACCOUNT ?? 8),
  sensitiveRateLimit: Number(process.env.SENSITIVE_RATE_LIMIT ?? 30),
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  rateLimitMaxBackoffMs: Number(process.env.RATE_LIMIT_MAX_BACKOFF_MS ?? 15 * 60_000),
};

if (!(["sqlite", "mysql"] as const).includes(config.databaseDriver)) {
  throw new Error("DATABASE_DRIVER must be sqlite or mysql");
}

if (config.databaseDriver === "mysql" && !config.databaseUrl) {
  throw new Error("DATABASE_URL is required when DATABASE_DRIVER=mysql");
}

if (config.isProduction && config.jwtSecret.startsWith("development-only")) {
  throw new Error("JWT_SECRET must be configured in production");
}

if (config.isProduction && config.tokenEncryptionKey.startsWith("development-only")) {
  throw new Error("TOKEN_ENCRYPTION_KEY or JWT_SECRET must be configured in production");
}
