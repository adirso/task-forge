import { mapGithubPullRequestState, parseDeliveryMonitorPullRequestUrl, type PullRequestState } from "@taskforge/contracts";

export type GithubPullRequest = { state: "open" | "closed"; merged_at: string | null; draft: boolean; head?: { sha?: string } };
export type GithubClientResult = { state: PullRequestState; headSha: string | null; etag: string | null };

export class GithubMonitorError extends Error {
  constructor(readonly category: "AUTHENTICATION" | "PERMISSION" | "RATE_LIMIT" | "NOT_FOUND" | "NETWORK" | "TIMEOUT", message: string) { super(message); }
}

export async function fetchGithubPullRequest(url: string, token?: string, fetcher: typeof fetch = fetch, etag?: string | null): Promise<GithubClientResult> {
  const parsed = parseDeliveryMonitorPullRequestUrl(url);
  if (!parsed) throw new GithubMonitorError("NOT_FOUND", "Pull-request URL is not a supported GitHub URL");
  const endpoint = `https://api.github.com/repos/${parsed.owner}/${parsed.repository}/pulls/${parsed.number}`;
  let response: Response;
  try { response = await fetcher(endpoint, { headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(etag ? { "if-none-match": etag } : {}) } }); }
  catch { throw new GithubMonitorError("NETWORK", "GitHub API is unreachable"); }
  if (response.status === 304) return { state: "OPEN", headSha: null, etag: response.headers.get("etag") ?? etag ?? null };
  if (response.status === 401) throw new GithubMonitorError("AUTHENTICATION", "GitHub App authentication failed");
  if (response.status === 403) throw new GithubMonitorError("PERMISSION", "GitHub App lacks pull-request read permission");
  if (response.status === 404) throw new GithubMonitorError("NOT_FOUND", "Pull request was not found");
  if (response.status === 429) throw new GithubMonitorError("RATE_LIMIT", "GitHub API rate limit reached");
  if (!response.ok) throw new GithubMonitorError("NETWORK", `GitHub API request failed (${response.status})`);
  const body = await response.json() as GithubPullRequest;
  return { state: mapGithubPullRequestState(body.state, body.merged_at, body.draft), headSha: body.head?.sha ?? null, etag: response.headers.get("etag") };
}
