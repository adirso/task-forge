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

    await page.getByRole("checkbox", { name: "Backlog" }).uncheck();
    await page.getByRole("checkbox", { name: "Refining" }).uncheck();
    await page.getByRole("checkbox", { name: "Ready for dev" }).uncheck();
    await page.getByRole("checkbox", { name: "Ready for review" }).uncheck();
    await page.getByRole("checkbox", { name: "In review" }).uncheck();
    await page.getByRole("checkbox", { name: "Done" }).uncheck();
    await page.getByRole("checkbox", { name: "Cancelled" }).uncheck();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { name: createdProjectName })).toBeVisible();
    await expect(page.getByRole("region", { name: "Done tasks" })).toHaveCount(0);

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

    await page.getByRole("button", { name: "List" }).click();
    await expect(page.getByRole("columnheader", { name: "Task" })).toBeVisible();
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await expect(page.getByRole("region", { name: "In progress tasks" })).toBeVisible();
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
