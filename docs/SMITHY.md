# Smithy runner

Smithy is an optional process runner. TaskForge never installs, authenticates, or launches provider CLIs; it only sends its normal signed agent webhook. Smithy receives that webhook, verifies the per-agent HMAC, runs the operator's configured command, and reports the run result through the public runs API.

## Configuration

Copy `apps/smithy/.env.example` to a private env file and fill in the agent webhook secrets and API tokens. Then run `npm run dev -w @taskforge/smithy` with:

```bash
export TASKFORGE_API_URL=http://127.0.0.1:4000
export SMITHY_PORT=4500
export SMITHY_PREFLIGHT=true # optional startup diagnostics; default is disabled
export SMITHY_PROVIDERS='{
  "claude": {"cmd":"claude -p --permission-mode auto {prompt}","webhookSecret":"whsec_...","apiToken":"tf_..."},
  "codex": {"cmd":"codex exec --approve-for-me {prompt}","webhookSecret":"whsec_...","apiToken":"tf_..."},
  "cursor": {"cmd":"cursor-agent -p --force --trust {prompt}","webhookSecret":"whsec_...","apiToken":"tf_..."}
}'
```

Smithy exposes `GET http://127.0.0.1:4500/health/providers` for a safe, on-demand provider check. Results contain only a provider label, status, redacted actionable message, and timestamp—never API tokens, webhook secrets, or full command output. By default each configured command's executable is checked with `--version`; add an optional provider `healthCmd` when an operator wants an authentication/login-status check. Set `SMITHY_PREFLIGHT=true` to run these checks at startup and print the same redacted diagnostics. Missing binaries, authentication failures, and permission errors are classified separately; checks never block webhook routing unless the provider command itself cannot execute.

For example:

```bash
cp apps/smithy/.env.example apps/smithy/.env.smithy
set -a; source apps/smithy/.env.smithy; set +a
npm run dev:agents
```

To add, edit, or remove a provider without hand-editing JSON, run the interactive configurator:

```bash
npm run configure -w @taskforge/smithy -- --file apps/smithy/.env.smithy
```

It supports the `claude`, `codex`, and `cursor` labels plus custom labels (`other`). It updates only `SMITHY_PROVIDERS`, preserves other `.env` settings, and never prints token or webhook-secret values. Leave a secret prompt blank when editing to keep the current value. Keep the resulting env file private.

Provider names are routing labels only. Configure each project's **Local Smithy repository path** in TaskForge project settings; Smithy uses that path for the task's worktree. An optional provider `repo` remains a fallback for projects without a path. The GitHub repository URL remains the remote/canonical link. Smithy uses `spawn` with `shell: false`, so prompt text is passed as an argument and never interpreted as shell syntax. Keep credentials outside the repository and use filesystem/secret-manager permissions appropriate for them.

TaskForge agent webhook URLs should point to `/agents/claude`, `/agents/codex`, or `/agents/cursor`. The API's `X-TaskForge-Signature` timestamp/HMAC is verified with a five-minute clock-skew tolerance. Duplicate event IDs are persisted in the SQLite job store, and pending/running jobs are resumed after restart (including the original run ID, so a restart never creates a second run). API calls use the configured bearer token, retry transient failures with bounded exponential backoff, and report progress plus `SUCCEEDED` or redacted `FAILED` run results through the public API. The signed prompt lists the enabled workflow and requires the assigned provider agent to perform each task status transition with the run ID; Smithy never PATCHes task statuses or silently substitutes a disabled status. A claimed run uses a two-minute lease and sends a heartbeat every 30 seconds while the command executes.

Each task branch gets its own `.smithy-worktrees/<task-id>` worktree under the configured repository, preventing concurrent provider runs from sharing a checkout. Tasks without a branch still get a detached worktree. The runner binds only to loopback; `SMITHY_HOST=0.0.0.0` is rejected. Start it explicitly with the root `npm run dev:agents` command (or the workspace command for local development). Review runs report findings and leave approval to the human gate; Smithy never auto-approves a review.

If a provider executable is not installed, Smithy acknowledges the webhook but records a failed run; install/configure the command and retry the run from TaskForge. Running no Smithy process is supported: TaskForge continues to provide statuses, evidence, reviews, and merge gates without automation.

## Recovery, replay, and ordering

Inbound agent webhooks are authenticated with the per-agent `X-TaskForge-Signature` HMAC and are persisted in the Smithy job store before execution. The event ID is the idempotency key: a duplicate delivery returns `202` without creating a second run. On restart, pending or running jobs are resumed from SQLite with their existing run ID. If a status event arrives after the task has already moved to another status, Smithy records the event as handled and does not start a run or emit a status handoff, preventing an out-of-order delivery from looping the workflow.

TaskForge delivery is at-least-once. Administrators can inspect failed deliveries and use the retry endpoint to replay a terminal failure with a fresh bounded attempt budget. Replay never reuses merge authorization: a changed PR head requires fresh checks and review. Keep the TaskForge database backup and the Smithy job-store file together when recovering an installation; restore the database first, then restart Smithy so its durable event IDs and run IDs remain correlated. A job that was RUNNING when Smithy crashed is reclaimed after its two-minute local lease window; the API run claim remains the cross-process conditional guard. To stop a local process, call `POST http://127.0.0.1:4500/jobs/{eventId}/cancel` from the loopback host; Smithy sends the correlated run a `CANCELLED` completion and will not retry it. Failed event deliveries can be replayed with the same event ID, preserving the existing run correlation and bounded API attempt budget. Logs contain redacted failure diagnostics only; do not copy webhook secrets, bearer tokens, or command configuration into incident tickets.

Delivery health is available from the administrator-only webhook metrics endpoint. Delivered history can be purged with the retention endpoint after a backup; pending, retrying, and failed deliveries are never removed by retention. A disaster-recovery drill should restore both stores, replay a failed delivery, and verify that duplicate event IDs remain idempotent.

Run tests with `npm test -w @taskforge/smithy`; the suite covers signature verification, path routing, command boundaries, idempotent delivery, redaction, and missing-provider behavior.
