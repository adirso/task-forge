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
  databaseDriver: (process.env.DATABASE_DRIVER ?? (process.env.DATABASE_URL ? "mysql" : "sqlite")) as "sqlite" | "mysql",
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET ?? "development-only-change-me-taskforge-secret",
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  isProduction: process.env.NODE_ENV === "production",
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
