import { expect, test, type Page } from "@playwright/test";

const admin = { email: "demo@taskforge.local", password: "demo1234" };
const member = { email: "maya@taskforge.local", password: "demo1234" };
const projectName = "Browser QA Workspace";

async function signIn(page: Page, credentials = admin) {
  await page.goto("/");
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(page.getByRole("button", { name: "Create project", exact: true })).toBeVisible({ timeout: 15_000 });
}

async function createProject(page: Page, name = `${projectName} ${Date.now() % 10000}`, key = `E${Date.now() % 1000000}`) {
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.getByLabel("Project name").fill(name);
  await page.getByLabel("Key").fill(key);
  await page.getByLabel("Description").fill("Deterministic browser regression fixture");
  await page.getByRole("button", { name: "Create project", exact: true }).last().click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  return name;
}

async function openProjectSettings(page: Page) {
  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("heading", { name: "Edit project" })).toBeVisible();
}

test.describe("workspace browser smoke", () => {
  test("login, project workflow, task editing, notes, attachment, and navigation", async ({ page }) => {
    await signIn(page);
    const createdProjectName = await createProject(page);
    await page.getByRole("button", { name: "View project members" }).click();
    await page.getByLabel("Add a person or agent").selectOption({ label: "Maya Chen · Human" });
    await page.getByRole("button", { name: "Add member" }).click();
    await expect(page.getByRole("dialog", { name: "Members & agents" }).getByText("Maya Chen", { exact: true })).toBeVisible();
    await page.getByRole("dialog", { name: "Members & agents" }).getByText("Close", { exact: true }).click();
    await openProjectSettings(page);

    await expect(page.getByText("Agent workflow", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Implementation Queue")).toHaveValue("TODO");
    await page.getByLabel("Implementation Queue").selectOption("IN_PROGRESS");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Project updated")).toBeVisible();
    await openProjectSettings(page);

    await page.getByRole("checkbox", { name: "Available status: Backlog" }).uncheck();
    await page.getByRole("checkbox", { name: "Available status: Refining" }).uncheck();
    await page.getByRole("checkbox", { name: "Available status: Ready for review" }).uncheck();
    await page.getByRole("checkbox", { name: "Available status: In review" }).uncheck();
    await page.getByRole("checkbox", { name: "Available status: Done" }).uncheck();
    await page.getByRole("checkbox", { name: "Available status: Cancelled" }).uncheck();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { name: createdProjectName })).toBeVisible();
    await expect(page.getByRole("region", { name: "Done tasks" })).toHaveCount(0);
    await openProjectSettings(page);
    await expect(page.getByRole("button", { name: "Enable default agent workflow" })).toBeVisible();
    await page.getByRole("button", { name: "Enable default agent workflow" }).click();
    await expect(page.getByText("Agent workflow enabled")).toBeVisible();

    await page.getByRole("button", { name: "Automations", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Automations" })).toBeVisible();
    await page.getByLabel("Rule name").fill("Route implementation agent");
    const automationRows = page.locator(".automation-rule-row");
    await automationRows.nth(0).locator("select").nth(1).selectOption("changed_to");
    await automationRows.nth(0).locator("select").nth(2).selectOption("TODO");
    await automationRows.nth(1).locator("select").nth(0).selectOption("assigneeId");
    await automationRows.nth(1).locator("select").nth(1).selectOption("actor");
    await page.getByRole("button", { name: "Create rule" }).click();
    await expect(page.getByText("Route implementation agent", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Board", exact: true }).click();

    await page.getByRole("button", { name: "Create task" }).first().click();
    await page.getByLabel("Task name").fill("Browser regression task");
    await page.getByLabel("Description").fill("Created through the browser smoke suite");
    await page.getByLabel("Definition of done").fill("Task can be edited and moved");
    await page.getByLabel("Task status").selectOption("TODO");
    await page.getByLabel("Task priority").selectOption("HIGH");
    await page.getByRole("dialog", { name: "Create a task" }).getByRole("button", { name: "Create task", exact: true }).click();
    await expect(page.getByRole("button", { name: /E\d+-\d+: Browser regression task/ })).toBeVisible();

    await page.getByRole("button", { name: /E\d+-\d+: Browser regression task/ }).click();
    await page.getByLabel("Task name").fill("Edited browser regression task");
    await page.getByLabel("Task status").selectOption("IN_PROGRESS");
    await page.getByPlaceholder("Share progress, a decision, or a blocker…").fill("Browser note survived the edit flow");
    await page.getByRole("button", { name: "Post update" }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: "e2e.txt", mimeType: "text/plain", buffer: Buffer.from("attachment") });
    await expect(page.getByText("e2e.txt", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Task updated")).toBeVisible();

    for (const status of ["READY_FOR_REVIEW", "IN_REVIEW", "FIX_NEEDED", "FIX_IN_PROGRESS", "RE_REVIEW", "APPROVED"]) {
      await page.getByRole("button", { name: /E\d+-\d+: Edited browser regression task/ }).click();
      await page.getByLabel("Task status").selectOption(status);
      await page.getByRole("button", { name: "Save changes", exact: true }).click();
      await expect(page.getByText("Task updated")).toBeVisible();
    }

    await page.getByRole("button", { name: "List" }).click();
    await expect(page.getByRole("columnheader", { name: "Task" })).toBeVisible();
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await expect(page.getByRole("region", { name: "Approved tasks" })).toBeVisible();
  });

  test("permission-denied state is visible to a non-owner", async ({ page }) => {
    await signIn(page);
    const createdProjectName = await createProject(page);
    await page.getByRole("button", { name: "View project members" }).click();
    await page.getByLabel("Add a person or agent").selectOption({ label: "Maya Chen · Human" });
    await page.getByRole("button", { name: "Add member" }).click();
    await expect(page.getByRole("dialog", { name: "Members & agents" }).getByText("Maya Chen", { exact: true })).toBeVisible();
    await page.getByRole("dialog", { name: "Members & agents" }).getByText("Close", { exact: true }).click();
    await page.getByRole("button", { name: "Log out" }).click();
    await page.getByRole("button", { name: "Log out", exact: true }).last().click();
    await signIn(page, member);
    await page.getByRole("button", { name: new RegExp(`${createdProjectName}\\. Drag to reorder`) }).click();
    await page.getByRole("button", { name: "Project actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);
  });

  test("shows live, stalled, failed, and completed Smithy run observability", async ({ page }) => {
    await signIn(page);
    await createProject(page, `Observability Workspace ${Date.now() % 10000}`, `O${Date.now() % 1000000}`);
    await page.getByRole("button", { name: "Create task" }).first().click();
    await page.getByLabel("Task name").fill("Browser observability task");
    await page.getByLabel("Description").fill("Run observability fixture");
    await page.getByLabel("Definition of done").fill("Run health is visible");
    await page.getByLabel("Task status").selectOption("TODO");
    await page.getByRole("dialog", { name: "Create a task" }).getByRole("button", { name: "Create task", exact: true }).click();
    await expect(page.getByRole("button", { name: /Browser observability task/ })).toBeVisible();

    const now = Date.now();
    await page.route("**/api/tasks/*/runs", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ runs: [
      { id: "00000000-0000-4000-8000-000000000701", taskId: "task", projectId: "project", requestedById: "agent", kind: "IMPLEMENTATION", status: "RUNNING", attemptCount: 1, maxAttempts: 3, leaseOwner: "smithy", leaseExpiresAt: new Date(now + 120000).toISOString(), heartbeatAt: new Date(now - 30000).toISOString(), timeoutAt: new Date(now + 300000).toISOString(), lastError: null, createdAt: new Date(now - 60000).toISOString(), updatedAt: new Date(now - 30000).toISOString(), completedAt: null },
      { id: "00000000-0000-4000-8000-000000000702", taskId: "task", projectId: "project", requestedById: "agent", kind: "FIX", status: "RUNNING", attemptCount: 2, maxAttempts: 3, leaseOwner: "smithy", leaseExpiresAt: new Date(now - 1000).toISOString(), heartbeatAt: new Date(now - 180000).toISOString(), timeoutAt: new Date(now + 300000).toISOString(), lastError: null, createdAt: new Date(now - 240000).toISOString(), updatedAt: new Date(now - 180000).toISOString(), completedAt: null },
      { id: "00000000-0000-4000-8000-000000000703", taskId: "task", projectId: "project", requestedById: "agent", kind: "REVIEW", status: "FAILED", attemptCount: 3, maxAttempts: 3, leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null, timeoutAt: null, lastError: "Provider exited", createdAt: new Date(now - 300000).toISOString(), updatedAt: new Date(now - 240000).toISOString(), completedAt: new Date(now - 240000).toISOString() },
      { id: "00000000-0000-4000-8000-000000000704", taskId: "task", projectId: "project", requestedById: "agent", kind: "RE_REVIEW", status: "SUCCEEDED", attemptCount: 1, maxAttempts: 3, leaseOwner: null, leaseExpiresAt: null, heartbeatAt: new Date(now - 600000).toISOString(), timeoutAt: null, lastError: null, createdAt: new Date(now - 600000).toISOString(), updatedAt: new Date(now - 500000).toISOString(), completedAt: new Date(now - 500000).toISOString() },
    ] }) }));
    await page.route("**/api/tasks/*/agent-logs*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ agentLogs: [
      { id: "log-701", taskId: "task", runId: "00000000-0000-4000-8000-000000000701", provider: "codex", stream: "stdout", category: "output", sequence: 3, eventId: null, content: "Waiting for permission to continue", createdAt: new Date(now - 10000).toISOString() },
      { id: "log-702", taskId: "task", runId: "00000000-0000-4000-8000-000000000702", provider: "codex", stream: "stderr", category: "output", sequence: 2, eventId: null, content: "Last stalled output", createdAt: new Date(now - 180000).toISOString() },
    ], page: { limit: 100, hasMore: false, nextCursor: null } }) }));
    await page.getByRole("button", { name: /Browser observability task/ }).click();
    await expect(page.getByText("Agent runs")).toBeVisible();
    await expect(page.getByText("Live", { exact: true })).toBeVisible();
    await expect(page.getByText("Lease expired", { exact: true })).toBeVisible();
    await expect(page.getByText("Failed", { exact: true })).toBeVisible();
    await expect(page.getByText("Completed", { exact: true })).toBeVisible();
    await expect(page.getByText("Waiting for provider input", { exact: true })).toBeVisible();
    await expect(page.getByText("Provider response timeline", { exact: false }).first()).toBeVisible();
  });
});

test.describe("mobile workspace smoke", () => {
  test("mobile navigation and task editing remain usable", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    const mobileNav = page.getByRole("complementary", { name: "Mobile navigation" });
    await expect(mobileNav.getByRole("button", { name: "Create project" })).toBeVisible();
    await mobileNav.getByRole("button", { name: /TaskForge.*Drag to reorder/ }).click();
    await expect(page.getByRole("heading", { name: "TaskForge" })).toBeVisible();
    await page.getByRole("button", { name: "Create task" }).first().click();
    const createDialog = page.getByRole("dialog", { name: "Create a task" });
    await createDialog.getByLabel("Task name").fill("Mobile browser task");
    await createDialog.getByLabel("Description").fill("Created on mobile");
    await createDialog.getByLabel("Definition of done").fill("Edited on mobile");
    await createDialog.getByLabel("Task status").selectOption("TODO");
    await createDialog.getByLabel("Task priority").selectOption("MEDIUM");
    await createDialog.getByRole("button", { name: "Create task", exact: true }).click();
    await page.getByRole("button", { name: /TF-\d+: Mobile browser task/ }).click();
    const editDialog = page.getByRole("dialog", { name: "Edit task" });
    await editDialog.getByLabel("Task name").fill("Edited mobile browser task");
    await editDialog.getByLabel("Task status").selectOption("IN_PROGRESS");
    await editDialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByText("Task updated")).toBeVisible();
  });
});
