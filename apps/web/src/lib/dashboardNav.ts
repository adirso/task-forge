export function projectBoardHref(base: string, projectKey: string): string {
  const url = new URL(base);
  url.search = "";
  url.searchParams.set("project", projectKey);
  return url.toString();
}

export function taskHref(base: string, projectKey: string, number: number): string {
  const url = new URL(base);
  url.search = "";
  url.searchParams.set("project", projectKey);
  url.searchParams.set("task", `${projectKey}-${number}`);
  return url.toString();
}

export function activityHref(
  base: string,
  event: { taskId: string | null; projectKey?: string | null; taskNumber?: number | null },
): string | null {
  if (!event.taskId || !event.projectKey || event.taskNumber == null) return null;
  return taskHref(base, event.projectKey, event.taskNumber);
}

export function openHref(href: string): void {
  window.location.href = href;
}

export function openProject(projectKey: string): void {
  openHref(projectBoardHref(window.location.href, projectKey));
}

export function openTask(projectKey: string, number: number): void {
  openHref(taskHref(window.location.href, projectKey, number));
}
