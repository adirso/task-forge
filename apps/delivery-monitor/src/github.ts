import { mapGithubPullRequestState, parseDeliveryMonitorPullRequestUrl, type PullRequestState } from "@taskforge/contracts";
import { createSign } from "node:crypto";

export type GithubPullRequest = { state: "open" | "closed"; merged_at: string | null; draft: boolean; head?: { sha?: string } };
export type GithubClientResult = { state: PullRequestState; headSha: string | null; etag: string | null };
export type GithubAppCredentials = { appId: string; installationId: string; privateKey: string };

export class GithubMonitorError extends Error {
  constructor(readonly category: "AUTHENTICATION" | "PERMISSION" | "RATE_LIMIT" | "NOT_FOUND" | "INVALID_URL" | "NETWORK" | "TIMEOUT", message: string) { super(message); }
}

function base64url(value: string) { return Buffer.from(value).toString("base64url"); }
export async function createGithubInstallationToken(credentials: GithubAppCredentials, fetcher: typeof fetch = fetch): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: now - 30, exp: now + 540, iss: credentials.appId }));
  const signer = createSign("RSA-SHA256"); signer.update(`${header}.${payload}`);
  const jwt = `${header}.${payload}.${signer.sign(credentials.privateKey, "base64url")}`;
  const response = await fetcher(`https://api.github.com/app/installations/${credentials.installationId}/access_tokens`, { method: "POST", headers: { accept: "application/vnd.github+json", authorization: `Bearer ${jwt}` } });
  if (response.status === 401) throw new GithubMonitorError("AUTHENTICATION", "GitHub App authentication failed");
  if (response.status === 403) throw new GithubMonitorError("PERMISSION", "GitHub App installation is not permitted");
  if (!response.ok) throw new GithubMonitorError("NETWORK", `GitHub App token request failed (${response.status})`);
  const body = await response.json() as { token?: string };
  if (!body.token) throw new GithubMonitorError("AUTHENTICATION", "GitHub App token response was invalid");
  return body.token;
}

export async function fetchGithubPullRequest(url: string, token?: string, fetcher: typeof fetch = fetch, etag?: string | null): Promise<GithubClientResult> {
  const parsed = parseDeliveryMonitorPullRequestUrl(url);
  if (!parsed) throw new GithubMonitorError("INVALID_URL", "Pull-request URL is not a supported GitHub URL");
  const endpoint = `https://api.github.com/repos/${parsed.owner}/${parsed.repository}/pulls/${parsed.number}`;
  let response: Response;
  try { response = await fetcher(endpoint, { headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(etag ? { "if-none-match": etag } : {}) } }); }
  catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "AbortError" || name === "TimeoutError") throw new GithubMonitorError("TIMEOUT", "GitHub API request timed out");
    throw new GithubMonitorError("NETWORK", "GitHub API is unreachable");
  }
  if (response.status === 304) return { state: "OPEN", headSha: null, etag: response.headers.get("etag") ?? etag ?? null };
  if (response.status === 401) throw new GithubMonitorError("AUTHENTICATION", "GitHub App authentication failed");
  if (response.status === 403) throw new GithubMonitorError("PERMISSION", "GitHub App lacks pull-request read permission");
  if (response.status === 404) throw new GithubMonitorError("NOT_FOUND", "Pull request was not found");
  if (response.status === 429) throw new GithubMonitorError("RATE_LIMIT", "GitHub API rate limit reached");
  if (!response.ok) throw new GithubMonitorError("NETWORK", `GitHub API request failed (${response.status})`);
  const body = await response.json() as GithubPullRequest;
  return { state: mapGithubPullRequestState(body.state, body.merged_at, body.draft), headSha: body.head?.sha ?? null, etag: response.headers.get("etag") };
}
