# Smithy runner

Smithy is an optional process runner. TaskForge never installs, authenticates, or launches provider CLIs; it only sends its normal signed agent webhook. Smithy receives that webhook, verifies the per-agent HMAC, runs the operator's configured command, and reports the run result through the public runs API.

## Configuration

Run `npm run dev -w @taskforge/smithy` with:

```bash
export TASKFORGE_API_URL=http://127.0.0.1:4000
export SMITHY_PORT=4500
export SMITHY_PROVIDERS='{
  "claude": {"cmd":"claude -p {prompt}","repo":"/work/task-forge","webhookSecret":"whsec_...","apiToken":"tf_..."},
  "codex": {"cmd":"codex exec {prompt}","repo":"/work/task-forge","webhookSecret":"whsec_...","apiToken":"tf_..."}
}'
```

Provider names are routing labels only. The command and repository are operator configuration; Smithy uses `spawn` with `shell: false`, so prompt text is passed as an argument and never interpreted as shell syntax. Keep this configuration outside the repository and use filesystem/secret-manager permissions appropriate for credentials.

TaskForge agent webhook URLs should point to `/agents/claude`, `/agents/codex`, or `/agents/cursor`. The API's `X-TaskForge-Signature` timestamp/HMAC is verified with a five-minute clock-skew tolerance. Duplicate event IDs are persisted in the SQLite job store, and pending/running jobs are resumed after restart (including the original run ID, so a restart never creates a second run). API calls use the configured bearer token, retry transient failures with bounded exponential backoff, and report progress, status handoffs, and `SUCCEEDED` or redacted `FAILED` results through the public API. A claimed run uses a two-minute lease and sends a heartbeat every 30 seconds while the command executes.

Each task branch gets its own `.smithy-worktrees/<task-id>` worktree under the configured repository, preventing concurrent provider runs from sharing a checkout. Tasks without a branch still get a detached worktree. The runner binds only to loopback; `SMITHY_HOST=0.0.0.0` is rejected. Start it explicitly with the root `npm run dev:agents` command (or the workspace command for local development). Review runs report findings and leave approval to the human gate; Smithy never auto-approves a review.

If a provider executable is not installed, Smithy acknowledges the webhook but records a failed run; install/configure the command and retry the run from TaskForge. Running no Smithy process is supported: TaskForge continues to provide statuses, evidence, reviews, and merge gates without automation.

Run tests with `npm test -w @taskforge/smithy`; the suite covers signature verification, path routing, command boundaries, idempotent delivery, redaction, and missing-provider behavior.
