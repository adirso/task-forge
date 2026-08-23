import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = path.join(root, ".e2e-data");
const env = {
  ...process.env,
  DATABASE_PATH: path.join(dataRoot, "taskforge.db"),
  ATTACHMENTS_PATH: path.join(dataRoot, "attachments"),
  HOST: "127.0.0.1",
  PORT: "4400",
  API_PORT: "4400",
  WEB_PORT: "5174",
  NODE_ENV: "test",
  JWT_SECRET: "taskforge-e2e-secret",
  TOKEN_ENCRYPTION_KEY: "taskforge-e2e-secret",
};

await rm(dataRoot, { recursive: true, force: true });
await mkdir(dataRoot, { recursive: true });
await run(process.execPath, ["--import", "tsx", "apps/api/src/db/seed.ts"], env);

const children = [
  spawn(process.execPath, ["--import", "tsx", "apps/api/src/index.ts"], { cwd: root, env, stdio: "inherit" }),
  spawn(process.execPath, ["../../node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5174"], { cwd: path.join(root, "apps/web"), env, stdio: "inherit" }),
];

function stop() {
  for (const child of children) child.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("exit", stop);

await new Promise((resolve) => children[0].once("exit", resolve));

function run(command, args, childEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: childEnv, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}
