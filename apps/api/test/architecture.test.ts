import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(here, "../src");
const routesRoot = path.join(sourceRoot, "routes");
const applicationRoot = path.join(sourceRoot, "application");

test("API route handlers stay free of persistence and row-mapping code", () => {
  for (const file of readdirSync(routesRoot).filter((name) => name.endsWith(".ts"))) {
    const source = readFileSync(path.join(routesRoot, file), "utf8");
    assert.doesNotMatch(source, /db\.prepare|\.transaction\(|\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/, `${file} contains persistence orchestration`);
    assert.doesNotMatch(source, /createRepositories\(/, `${file} constructs repositories inside the transport layer`);
    assert.doesNotMatch(source, /requireProjectAccess|requireProjectOwnerOrAdmin|toTask\(|toProject\(/, `${file} contains infrastructure mapping or authorization`);
  }
});

test("application layer owns the migrated route use cases", () => {
  const files = readdirSync(applicationRoot).filter((name) => name.endsWith(".ts")).map((name) => readFileSync(path.join(applicationRoot, name), "utf8")).join("\n");
  for (const service of ["TaskApplicationService", "ProjectApplicationService", "PhaseApplicationService", "UserApplicationService", "NotificationApplicationService", "SearchApplicationService", "ContextApplicationService", "ActivityApplicationService", "DashboardApplicationService"]) {
    assert.match(files, new RegExp(`class ${service}`), `${service} is not defined in the application layer`);
  }
  assert.doesNotMatch(files, /from ["'][^"']*routes\//, "application code must not depend on HTTP routes");
});
