import { expect, test, type Page } from "@playwright/test";

async function openDashboard(page: Page, mobile = false) {
  await page.goto("/");
  await page.getByLabel("Email address").fill("demo@taskforge.local");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: /continue/i }).click();
  if (mobile) await page.getByRole("button", { name: "Open navigation menu" }).click();
  await page.getByRole("button", { name: "TaskForge. Drag to reorder", exact: true }).click();
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(page.getByRole("heading", { name: "TaskForge dashboard" })).toBeVisible();
  await expect(page.locator(".project-dashboard-metrics")).toBeVisible();
}

for (const mobile of [false, true]) {
  test(`${mobile ? "mobile workspace smoke" : "workspace browser smoke"}: project modules customize and persist`, async ({ page }) => {
    await openDashboard(page, mobile);
    const dashboard = page.locator(".project-dashboard");
    await expect(dashboard.locator(".widget-card")).toHaveCount(7);
    await expect(dashboard.locator(mobile ? ".dashboard-mobile-list" : ".dashboard-grid")).toBeVisible();
    await page.getByRole("button", { name: "Close Workflow distribution widget", exact: true }).click();
    await expect(dashboard.locator(".widget-card")).toHaveCount(6);
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await page.getByRole("button", { name: "Dashboard", exact: true }).click();
    await expect(dashboard.locator(".widget-card")).toHaveCount(6);
    await page.getByRole("button", { name: "Add widget", exact: true }).click();
    await page.locator(".widget-picker-item").filter({ hasText: "Workflow distribution" }).click();
    await expect(dashboard.locator(".widget-card")).toHaveCount(7);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Reset layout", exact: true }).click();
    await expect(dashboard.locator(".widget-header-title").first()).toHaveText("Workflow distribution");
    if (mobile) {
      expect(await dashboard.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    } else {
      const first = dashboard.locator(".dashboard-grid-item").first();
      const before = await first.boundingBox();
      const resize = first.locator(".react-resizable-handle-se");
      await resize.scrollIntoViewIfNeeded();
      const box = await resize.boundingBox();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.mouse.down();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2 + 88, { steps: 10 });
      await page.mouse.up();
      await expect.poll(async () => (await first.boundingBox())!.height).toBeGreaterThan(before!.height);
    }
    await page.getByRole("heading", { name: "TaskForge dashboard" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/tas119-${mobile ? "mobile" : "desktop"}.png`, fullPage: true });
  });
}

test("workspace browser smoke: project metrics loading, failure, retry and empty states", async ({ page }) => {
  await openDashboard(page);
  let fail = true;
  await page.route("**/api/projects/*/tasks?**", async (route) => {
    if (fail) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Temporarily unavailable" }) });
    else await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tasks: [] }) });
  });
  await page.getByRole("button", { name: "Refresh project data" }).click();
  await expect(page.getByText("Could not load project metrics.")).toHaveCount(7);
  fail = false;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/projects/*/phases", async (route) => { await pending; await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ phases: [] }) }); });
  await page.getByRole("button", { name: "Retry", exact: true }).first().click();
  await expect(page.getByText("Loading project metrics…")).toHaveCount(7);
  release();
  await expect(page.getByText("No tasks in this project yet.")).toBeVisible();
  await expect(page.getByText("No phases in this project yet.")).toBeVisible();
  await expect(page.getByText("No duration data yet.")).toBeVisible();
  await page.route("**/api/delivery-monitor/health", (route) => route.fulfill({ status: 503, body: "{}" }));
  await page.getByRole("button", { name: "Refresh Delivery checkpoints widget" }).click();
  await expect(page.getByText("Could not load delivery checkpoints.")).toBeVisible();
});

test("workspace browser smoke: home and project layouts remain independent", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("button", { name: "Close Workflow distribution widget", exact: true }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close Project status widget" })).toBeVisible();
  await page.getByRole("button", { name: "Close Project status widget" }).click();
  await page.getByRole("button", { name: "TaskForge. Drag to reorder", exact: true }).click();
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close Workflow distribution widget" })).toHaveCount(0);
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.getByLabel("Project name").fill("Dashboard isolation");
  await page.getByLabel("Key", { exact: true }).fill("DSH");
  await page.getByRole("button", { name: "Create project", exact: true }).last().click();
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dashboard isolation dashboard" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close Workflow distribution widget" })).toBeVisible();
  await expect(page.getByText("No tasks in this project yet.")).toBeVisible();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close Project status widget" })).toHaveCount(0);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset layout" }).click();
  await expect(page.getByRole("button", { name: "Close Project status widget" })).toBeVisible();
});
