import { validateDeliveryMonitorDestinations, type PullRequestState } from "@taskforge/contracts";
import { fetchGithubPullRequest, type GithubClientResult } from "./github.js";

export type MonitorTask = { id: string; runId?: string; status: string; pullRequestUrl: string | null; availableStatuses: readonly string[]; approvalStatus: string };
export type SyncTaskOutcome = { state: PullRequestState | null; transitionedTo: "DONE" | "CANCELLED" | null; skipped: boolean; errorCategory: string | null };
export async function syncTask(task: MonitorTask, options: { fetchPullRequest?: () => Promise<GithubClientResult>; updateTask: (patch: { pullRequestState: PullRequestState; status?: "DONE" | "CANCELLED" }) => Promise<void>; recordActivity?: (activity: { state: PullRequestState | null; errorCategory: string | null; runId: string }) => Promise<void> }): Promise<SyncTaskOutcome> {
  if (!task.pullRequestUrl || task.status !== task.approvalStatus) return { state: null, transitionedTo: null, skipped: true, errorCategory: null };
  try {
    const result = await (options.fetchPullRequest ?? (() => fetchGithubPullRequest(task.pullRequestUrl!)) )();
    await options.recordActivity?.({ state: result.state, errorCategory: null, runId: task.runId ?? task.id });
    if (result.state === "MERGED" || result.state === "CLOSED") {
      const destinations = validateDeliveryMonitorDestinations(task.availableStatuses);
      const destination = result.state === "MERGED" ? destinations.merged : destinations.closed;
      await options.updateTask({ pullRequestState: result.state, status: destination });
      return { state: result.state, transitionedTo: destination, skipped: false, errorCategory: null };
    }
    await options.updateTask({ pullRequestState: result.state });
    return { state: result.state, transitionedTo: null, skipped: false, errorCategory: null };
  } catch (error) {
    const errorCategory = error instanceof Error && "category" in error ? String((error as { category: unknown }).category) : "UNKNOWN";
    await options.recordActivity?.({ state: null, errorCategory, runId: task.runId ?? task.id });
    return { state: null, transitionedTo: null, skipped: false, errorCategory };
  }
}
