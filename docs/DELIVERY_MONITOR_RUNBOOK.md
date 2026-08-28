# Delivery Monitor operator runbook

The Delivery Monitor is an optional, separate worker. It polls pull requests on
tasks in a project's configured workflow approval status and moves only terminal
states through the TaskForge transition service. It never approves or merges a
pull request.

## Install and configure

Install the workspace dependencies with `npm ci`, then configure the worker's
environment. For a local SQLite worker:

```dotenv
TASKFORGE_API_URL=http://127.0.0.1:5173
TASKFORGE_PROJECT_ID=<project-id>
TASKFORGE_TOKEN=<agent-token>
DATABASE_DRIVER=sqlite
DATABASE_PATH=./data/taskforge.db
GITHUB_APP_ID=<app-id>
GITHUB_INSTALLATION_ID=<installation-id>
GITHUB_PRIVATE_KEY=<private-key>
```

The GitHub App needs repository **Metadata: read**, **Contents: read**, and
**Pull requests: read** only. Install it only on repositories that should be
monitored. Do not put tokens or private keys in source control, updates, or
logs. `DATABASE_DRIVER=mysql` with `DATABASE_URL` runs the same worker against
MySQL 8+.

Before enabling monitoring, the project must have its workflow approval status
enabled and must include both `DONE` and `CANCELLED` in `availableStatuses`.
The monitor validates these destinations before applying a terminal transition.

## Run and tune

Run the continuous worker with `npm run dev:delivery-monitor`. To perform one
bounded sweep (useful for a cron job or a smoke test), run
`npm run delivery-monitor:sync`. The safe defaults are a 60-second poll
interval, a batch of 100 tasks (maximum 500), a 120-second lease, and bounded
exponential retries (maximum five attempts). Override them with
`DELIVERY_MONITOR_POLL_INTERVAL_MS`, `DELIVERY_MONITOR_BATCH_SIZE`,
`DELIVERY_MONITOR_LEASE_DURATION_MS`, and `DELIVERY_MONITOR_MAX_RETRIES`.
Set `DELIVERY_MONITOR_ENABLED=false` to disable polling.

Checkpoints are keyed by run, task, and pull-request URL. They retain the last
state, observation time, ETag, retry count, next attempt, and redacted error.
Leases prevent two workers from processing the same run concurrently. A worker
restart reuses the existing checkpoint and run; it does not create a duplicate
run. Retries and callbacks are idempotent.

## Observe and recover

Authenticated operators can inspect `/api/delivery-monitor/health` for liveness,
last sweep, processed checkpoints, active leases, next retry, and failed
checkpoints. `/api/delivery-monitor/tasks/:taskId` shows the latest observation
for one task. The dashboard's **Delivery Monitor health** card exposes the same
redacted state.

The monitor reports only these error categories: `AUTHENTICATION`, `PERMISSION`,
`RATE_LIMIT`, `NOT_FOUND`, `INVALID_URL`, `NETWORK`, `TIMEOUT`, and `UNKNOWN`.
For a failed checkpoint, wait for `nextRetryAt` or run the one-shot command;
correct the GitHub App installation, URL, credentials, or project statuses first.
No terminal transition is attempted for an invalid URL, missing PR metadata,
authentication failure, rate limit, timeout, or outage. Open and draft PRs stay
in the approval status. A merged PR transitions to `DONE`; a closed but
unmerged PR transitions to `CANCELLED`.

If a lease is active, allow it to expire before starting another worker. If a
worker stopped after a commit, inspect the checkpoint and TaskForge run evidence
then restart the worker; the same branch, run, and PR metadata are reused.
Never edit checkpoint rows or the migration ledger manually. Back up the
database before production recovery and keep merge authorization with a human.

## MySQL and test validation

SQLite is the default deterministic test database. To run the monitor's MySQL
coverage against an isolated database, set `TEST_DATABASE_URL` and run
`npm run test -w @taskforge/delivery-monitor`; never point it at production.
The fake-GitHub suite covers open, draft, merged, closed, malformed and missing
PRs, authentication/rate-limit/network/timeout failures, ETags, retries,
duplicate callbacks, restart recovery, and concurrent workers.
