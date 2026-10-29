import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const admin = { email: "demo@taskforge.local", password: "demo1234" };
const member = { email: "maya@taskforge.local", password: "demo1234" };

async function signIn(page: Page, credentials = admin) {
  await page.goto("/");
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(page.getByRole("button", { name: "Create project", exact: true })).toBeVisible({ timeout: 15_000 });
  return (await page.evaluate(() => localStorage.getItem("taskforge_token")))!;
}

function caller(request: APIRequestContext, token: string) {
  return async (method: string, url: string, data?: unknown) => {
    const response = await request.fetch(url, { method, headers: { authorization: `Bearer ${token}` }, data });
    return { status: response.status(), body: response.status() === 204 ? null : await response.json() };
  };
}

async function openProjectSettings(page: Page) {
  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("heading", { name: "Edit project" })).toBeVisible();
}

test.describe("workspace browser smoke", () => {
  test("project archive requires confirmation, keeps tasks, and is reachable from the archived view and deep links", async ({ page, request }) => {
    const adminCall = caller(request, await signIn(page));
    const suffix = String(Date.now() % 1000000);
    const key = `A${suffix}`;
    const name = `Archive QA ${suffix}`;
    const project = (await adminCall("POST", "/api/projects", { key, name, description: "Archive browser fixture", color: "#36B37E" })).body.project;
    const maya = (await adminCall("GET", "/api/users")).body.users.find((user: { email: string }) => user.email === member.email);
    expect((await adminCall("POST", `/api/projects/${project.id}/members`, { userId: maya.id, role: "MEMBER" })).status).toBe(204);
    expect((await adminCall("POST", `/api/projects/${project.id}/tasks`, { title: "Archived work stays put", status: "IN_PROGRESS" })).status).toBe(201);

    await page.goto(`/?project=${key}&view=list`);
    await expect(page.getByRole("heading", { name })).toBeVisible();
    const activeNavItem = page.getByRole("button", { name: `${name}. Drag to reorder`, exact: true });
    await expect(activeNavItem).toBeVisible();

    // Cancelling the confirmation leaves the project active.
    await openProjectSettings(page);
    await page.getByRole("button", { name: "Archive project" }).click();
    const dialog = page.getByRole("dialog", { name: `Archive ${name}?` });
    await expect(dialog).toContainText("tasks, phases, and history are kept unchanged");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(activeNavItem).toBeVisible();
    await expect(page.locator(".project-archived-badge")).toHaveCount(0);

    await openProjectSettings(page);
    await page.getByRole("button", { name: "Archive project" }).click();
    await dialog.getByRole("button", { name: "Archive project" }).click();
    await expect(page.locator(".toast")).toHaveText("Project archived");
    await expect(page.locator(".project-archived-badge")).toHaveText("Archived");
    const archivedNavItem = page.getByRole("button", { name: `${name}. Archived`, exact: true });
    await expect(archivedNavItem).toBeVisible();
    await expect(page).toHaveURL(/projects=archived/);
    await expect(page.getByText("Archived work stays put")).toBeVisible();

    // Archived state persists across a refresh, and the archived view is deep-linkable.
    await page.reload();
    await expect(page.locator(".project-archived-badge")).toHaveText("Archived");
    await expect(archivedNavItem).toBeVisible();
    await page.getByRole("button", { name: "Show active projects" }).click();
    await expect(page.getByRole("button", { name: new RegExp(`^${name}\\.`) })).toHaveCount(0);
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await page.goto("/?projects=archived");
    await expect(archivedNavItem).toBeVisible();
    await archivedNavItem.click();
    await expect(page.locator(".project-archived-badge")).toBeVisible();

    // A deep link to an archived project opens it with its tasks intact.
    await page.goto(`/?project=${key}&view=list`);
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.locator(".project-archived-badge")).toBeVisible();
    await expect(page.getByText("Archived work stays put")).toBeVisible();

    // Members can view archived projects but cannot archive or restore them.
    await page.evaluate(() => localStorage.clear());
    const memberCall = caller(request, await signIn(page, member));
    await page.goto(`/?project=${key}&view=list`);
    await expect(page.locator(".project-archived-badge")).toBeVisible();
    await expect(page.getByRole("button", { name: `${name}. Archived`, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Project actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Edit" })).toHaveCount(0);
    expect((await memberCall("POST", `/api/projects/${project.id}/restore`)).status).toBe(403);
    expect((await memberCall("POST", `/api/projects/${project.id}/archive`)).status).toBe(403);

    // Restoring returns the project to the active list.
    await page.evaluate(() => localStorage.clear());
    await signIn(page);
    await page.goto(`/?project=${key}&view=list`);
    await openProjectSettings(page);
    await page.getByRole("button", { name: "Restore project" }).click();
    const restoreDialog = page.getByRole("dialog", { name: `Restore ${name}?` });
    await restoreDialog.getByRole("button", { name: "Restore project" }).click();
    await expect(page.locator(".toast")).toHaveText("Project restored");
    await expect(page.locator(".project-archived-badge")).toHaveCount(0);
    await expect(activeNavItem).toBeVisible();
    expect((await adminCall("GET", `/api/projects/${project.id}/tasks`)).body.tasks.map((task: { status: string }) => task.status)).toEqual(["IN_PROGRESS"]);
  });

  test("a failed project list refresh after archiving cannot reopen or flip the confirmation", async ({ page, request }) => {
    const adminCall = caller(request, await signIn(page));
    const suffix = String(Date.now() % 1000000);
    const key = `F${suffix}`;
    const name = `Archive fault ${suffix}`;
    const project = (await adminCall("POST", "/api/projects", { key, name, description: "Fault injection fixture", color: "#FF5630" })).body.project;
    await page.goto(`/?project=${key}&view=list`);
    await expect(page.getByRole("heading", { name })).toBeVisible();

    let archivePosts = 0;
    let failedListGets = 0;
    page.on("request", (sent) => { if (sent.method() === "POST" && new URL(sent.url()).pathname.endsWith(`/projects/${project.id}/archive`)) archivePosts += 1; });
    // Every follow-up project list GET fails once the archive mutation has been confirmed.
    const projectListUrl = (url: URL) => url.pathname === "/api/projects";
    await page.route(projectListUrl, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      failedListGets += 1;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporarily unavailable" }) });
    });

    await openProjectSettings(page);
    await page.getByRole("button", { name: "Archive project" }).click();
    const dialog = page.getByRole("dialog", { name: `Archive ${name}?` });
    await dialog.getByRole("button", { name: "Archive project" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("dialog", { name: `Restore ${name}?` })).toHaveCount(0);
    await expect(page.locator(".toast")).toHaveText(/Could not (refresh project lists|load archived projects)/);
    await expect.poll(() => failedListGets).toBeGreaterThan(0);
    await expect(page.locator(".project-archived-badge")).toHaveText("Archived");
    await expect(page.getByRole("button", { name: `${name}. Archived`, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: `${name}. Drag to reorder`, exact: true })).toHaveCount(0);
    expect(archivePosts).toBe(1);
    expect((await adminCall("GET", `/api/projects/${project.id}`)).body.project.archivedAt).toBeTruthy();

    await page.unroute(projectListUrl);
    await page.reload();
    await expect(page.locator(".project-archived-badge")).toHaveText("Archived");

    // Creating a project from the archived view switches the sidebar back to active projects.
    const createdName = `Active after archive ${suffix}`;
    await page.getByRole("button", { name: "Create project", exact: true }).click();
    await page.getByLabel("Project name").fill(createdName);
    await page.getByLabel("Key").fill(`G${suffix}`);
    await page.getByRole("button", { name: "Create project", exact: true }).last().click();
    await expect(page.getByRole("heading", { name: createdName })).toBeVisible();
    await expect(page.getByRole("button", { name: `${createdName}. Drag to reorder`, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Show archived projects" })).toBeVisible();
    await expect(page).not.toHaveURL(/projects=archived/);
  });
});

test.describe("mobile workspace smoke", () => {
  test("mobile project archive confirmation fits, cancels, confirms, and stays reachable after reload", async ({ page, request }) => {
    const adminCall = caller(request, await signIn(page));
    const suffix = String(Date.now() % 1000000);
    const key = `M${suffix}`;
    const name = `Mobile archive ${suffix}`;
    const project = (await adminCall("POST", "/api/projects", { key, name, description: "Mobile archive fixture", color: "#6554C0" })).body.project;
    expect((await adminCall("POST", `/api/projects/${project.id}/tasks`, { title: "Mobile archived task", status: "TODO" })).status).toBe(201);
    await page.goto(`/?project=${key}&view=list`);
    await expect(page.getByRole("heading", { name })).toBeVisible();

    const viewport = page.viewportSize()!;
    const dialog = page.getByRole("dialog", { name: `Archive ${name}?` });
    await openProjectSettings(page);
    await page.getByRole("button", { name: "Archive project" }).click();
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await expect(dialog.getByRole("button", { name: "Archive project" })).toBeInViewport();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(".project-archived-badge")).toHaveCount(0);

    await openProjectSettings(page);
    await page.getByRole("button", { name: "Archive project" }).click();
    await dialog.getByRole("button", { name: "Archive project" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(".project-archived-badge")).toBeVisible();

    const mobileNav = page.getByRole("complementary", { name: "Mobile navigation" });
    const archivedItem = mobileNav.getByRole("button", { name: `${name}. Archived`, exact: true });
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    await expect(archivedItem).toBeVisible();
    await mobileNav.getByRole("button", { name: "Show active projects" }).click();
    await expect(archivedItem).toHaveCount(0);
    await expect(mobileNav.getByRole("button", { name: `${name}. Drag to reorder`, exact: true })).toHaveCount(0);
    await mobileNav.getByRole("button", { name: "Home", exact: true }).click();
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    await mobileNav.getByRole("button", { name: "Show archived projects" }).click();
    await archivedItem.click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.locator(".project-archived-badge")).toBeVisible();
    await expect(page.getByText("Mobile archived task").first()).toBeVisible();

    await page.reload();
    await expect(page.locator(".project-archived-badge")).toBeVisible();
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    await expect(archivedItem).toBeVisible();
  });
});
