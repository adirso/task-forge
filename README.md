# TaskForge

TaskForge is a local-first project and task manager for teams made of people and software agents. It combines a workflow board with a structured list, backed by a typed HTTP API.

Contributor and agent workflow conventions are documented in [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md).

## What is included

- Human login with 8-hour JWT sessions
- Agent identities with hashed, revocable, optionally expiring API tokens
- Project ownership, membership, repository links, keys, colors, and descriptions
- Tasks with a stable project number, description, definition of done, workflow status, priority, type (feature, bug, infra, update, security, docs, chore), assignee, creator, branch, pull request, parent task, due date, estimate, and ordering
- Chronological task notes and progress updates authored by people or agents
- Numbered project phases with goals, one active phase for the board, and phase-grouped list planning
- Five-column drag-and-drop board and sortable-feeling structured list view
- Current-project filtering plus cross-project task search with `⌘K`
- Persistent notifications for assignments and review requests, with unread state and direct task navigation
- Working settings for account details, default view, text size, agent identities, and API-token lifecycle management
- Shareable `?project=KEY&task=KEY-N` deep links for people and agents
- SQLite or MySQL persistence, validation, project access checks, activity records, and cascade-safe nested tasks
- Interactive API documentation at `http://127.0.0.1:4000/docs/`

## Dashboard examples

The following screenshots show the main project views available in TaskForge:

### Home dashboard

![TaskForge home dashboard example](docs/images/dashboard-example-home.png)

### Board view

![TaskForge board view example](docs/images/dashboard-example-board.png)

### Send to AI

![TaskForge send to AI example](docs/images/dashboard-example-send-to-ai.png)

## Quick start

Requirements: Git, Node.js 22 or newer, and npm 10 or newer. CI uses Node.js 22 LTS. SQLite is bundled for the default development setup; Docker is only needed for local MySQL or browser-test services.

```bash
npm ci
cp .env.example .env
npm run db:seed
npm run dev
# Optional agent runner (separate loopback process):
npm run dev:agents
```

Open `http://127.0.0.1:5173` and use:

```text
Email:    demo@taskforge.local
Password: demo1234
```

SQLite is the default for local development and is created at `data/taskforge.db`. Seeding is idempotent and adds a sample project, people, an agent identity, and ten representative tasks.

The Smithy runner is intentionally excluded from `npm run dev`; configure it separately with the Smithy workspace commands.

Recommended project-owned handoff automations are opt-in; no migration creates them.

## Configuration

The root `.env.example` is the source of truth for local API settings:

```bash
cp .env.example .env
```

Important variables:

| Variable | Local default | Purpose |
| --- | --- | --- |
| `PORT` / `HOST` | `4000` / `127.0.0.1` | API bind address |
| `DATABASE_DRIVER` | `sqlite` | Select `sqlite` or `mysql` |
| `DATABASE_PATH` | `./data/taskforge.db` | SQLite file path |
| `DATABASE_URL` | — | MySQL connection URL |
| `JWT_SECRET` | placeholder | Session signing secret; replace outside local demos |
| `CORS_ORIGIN` | localhost and loopback web origins | Allowed browser origins |
| `TRUST_PROXY` | unset | Trusted proxy addresses, never arbitrary client input |

Never commit `.env`, database files, agent tokens, webhook secrets, or production credentials. Put the API behind TLS before exposing it beyond localhost.

### MySQL development

SQLite is recommended for day-to-day development. To exercise MySQL-specific behavior, start a disposable MySQL 8 instance and set `DATABASE_DRIVER=mysql` and `DATABASE_URL` in a shell or env file. Do not point tests or local migrations at production; the test suite creates and modifies its database.

## Workspace layout

```text
apps/
  api/        Fastify API, SQLite/MySQL schema, seed, integration tests
  web/        React/Vite client
  smithy/     Optional signed Beta runner for configured agent commands
packages/
  contracts/  Shared Zod validation and TypeScript domain types
e2e/          Playwright browser regression tests
AGENTS.md     Contributor and agent development guidance
CLAUDE.md     Claude Code workflow guidance
.github/      GitHub Actions CI workflow
```

## Commands

```bash
npm run dev        # API on :4000 and web app on :5173
npm run build      # Production builds for all workspaces
npm run typecheck  # Strict TypeScript checks
npm test           # Tests for every workspace
npm run db:seed    # Idempotent demo seed
npm run admin:bootstrap # Create or rotate the production administrator
npm run test:e2e     # Browser regression suite (install Chromium once first)
npm run test:e2e:install
```

Workspace-specific commands use npm's workspace flag, for example `npm test -w @taskforge/api`, `npm run typecheck -w @taskforge/web`, or `npm run configure -w @taskforge/smithy -- --file apps/smithy/.env.smithy`.

## Development workflow

1. Create a branch from `main` and keep changes focused.
2. Run `npm ci` after changing branches or the lockfile.
3. Use `npm run dev` for the API and web app; use `npm run dev:agents` only when testing the optional Smithy Beta runner.
4. Add or update focused tests with code changes. Run `npm run typecheck`, `npm run build`, and `npm test` before opening a pull request.
5. For schema changes, use the versioned migration registry and add SQLite/MySQL upgrade coverage.
6. Do not edit generated data, local env files, or unrelated migrations. Describe behavior changes, test commands, and known limitations in the pull request.

## Architecture at a glance

- `apps/web` is the React/Vite browser client and talks to the API through `/api`.
- `apps/api` is a Fastify transport layer over application services, repositories, and the SQLite/MySQL database adapters.
- `packages/contracts` contains shared Zod schemas and TypeScript contracts used by API and web.
- `apps/smithy` is an optional loopback runner. It receives signed webhooks and executes operator-configured commands; the API never launches provider processes.
- `apps/api/src/db/database.ts` applies ordered, ledgered migrations at startup.

Keep SQL and driver-specific behavior in repositories, authorization and orchestration in application services, and request parsing/response presentation in routes.

## Continuous integration

Every pull request and push to `main` runs the required **Quality and SQLite**, **API on MySQL 8**, and **Browser E2E** checks. Browser E2E can be run locally with `npm run test:e2e` after `npm run test:e2e:install`.

The root `package.json` is the single source of truth for the release version;
keep `package-lock.json` synchronized when changing it (for example, with
`npm version --no-git-tag-version <major.minor.patch>`). Every pull request
must increase the strict `MAJOR.MINOR.PATCH` version relative to its base
branch. The `Version guard` check rejects unchanged, lower, or malformed
versions and must be marked as a required status check in the protected
`main`/`master` branch rules.

Every merge to `main` or `master` triggers the **Release tag** workflow. It
validates the manifest and creates an annotated `vMAJOR.MINOR.PATCH` tag on the
exact merged commit. Re-running a workflow is safe when the tag already points
to that commit; a conflicting tag causes a visible failure and must be resolved
before retrying. The workflow has only `contents: write` permission.

## API overview

All application endpoints are under `/api`. Send either a human JWT or agent token as `Authorization: Bearer <credential>`.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Exchange human credentials for a JWT |
| `GET` | `/api/auth/me` | Resolve the current identity |
| `GET/POST` | `/api/projects` | List or create projects |
| `GET/PATCH/DELETE` | `/api/projects/:id` | Read, update, or owner/admin-delete a project |
| `POST` | `/api/projects/:id/members` | Add a person or agent (owner/admin only) |
| `DELETE` | `/api/projects/:id/members/:userId` | Remove a member and unassign their tasks (owner/admin only) |
| `GET/POST` | `/api/projects/:id/tasks` | List or create project tasks |
| `GET/POST` | `/api/projects/:id/phases` | List or create project phases |
| `PATCH/DELETE` | `/api/phases/:id` | Activate, edit, or delete a phase |
| `GET/PATCH/DELETE` | `/api/tasks/:id` | Read, update, or delete a task |
| `GET/POST` | `/api/tasks/:id/updates` | Read or post task notes and progress updates |
| `GET/POST` | `/api/tasks/:id/runs` | List or create autonomous agent runs |
| `POST` | `/api/runs/:id/claim` | Claim a run lease |
| `POST` | `/api/runs/:id/heartbeat` | Renew a run lease |
| `POST` | `/api/runs/:id/complete` | Complete, fail, or cancel a run |
| `GET` | `/api/users` | List people and agents |
| `POST` | `/api/users/agents` | Create an agent identity (admin) |
| `POST/GET` | `/api/users/:id/tokens` | Issue or list token metadata |
| `DELETE` | `/api/users/tokens/:id` | Revoke a token |
| `GET` | `/api/notifications` | List notifications and unread count |
| `PATCH` | `/api/notifications/:id/read` | Mark one notification as read |
| `POST` | `/api/notifications/read-all` | Mark every notification as read |
| `GET` | `/api/search?q=...` | Search accessible tasks across projects |
| `GET` | `/api/context?project=TF&task=TF-4` | Resolve a shared project/task link without UUIDs |

## Contributing

TaskForge is an open-source project and welcomes issues, documentation improvements, tests, and code contributions. Before contributing:

- Search existing issues and pull requests, then describe the user-visible problem and proposed behavior.
- Follow the repository's existing TypeScript, React, Fastify, and migration patterns; avoid broad formatting-only changes.
- Include regression tests for bug fixes and cross-driver tests for persistence changes.
- Never include secrets, real credentials, private repository paths, or generated database files in commits.
- Keep Smithy changes provider-agnostic: provider names are routing labels and commands remain operator configuration.

Pull requests should explain the change, list validation commands, call out skipped checks (for example a local native-module limitation), and identify any migration or rollout considerations. Automated checks are required before merge.

## Troubleshooting

- **The web app cannot reach the API:** confirm the API is listening on `http://127.0.0.1:4000` and the web app on `http://127.0.0.1:5173`; restart `npm run dev` after changing `.env`.
- **`better-sqlite3` reports a `NODE_MODULE_VERSION` mismatch:** use Node.js 22, then run `npm ci` (or rebuild the dependency with `npm rebuild better-sqlite3`) before rerunning tests.
- **A migration fails at startup:** stop the API, back up the database, and read the row-level diagnostics. Do not edit the migration ledger manually.
- **MySQL tests fail:** ensure `TEST_DATABASE_URL` points to a disposable MySQL 8 database that is ready to accept connections; never use a production database.
- **Browser tests fail:** install Chromium with `npm run test:e2e:install`, then rerun `npm run test:e2e`; inspect Playwright traces and screenshots from `test-results/`.

## Production notes

- Set a long random `JWT_SECRET`; startup refuses the development secret when `NODE_ENV=production`.
- Restrict the comma-separated `CORS_ORIGIN` list to the deployed web origin(s). Local development accepts both `localhost` and `127.0.0.1`.
- API tokens are only returned once. Only their SHA-256 hashes and non-secret prefixes are stored.
- Use MySQL 8 or newer in production. TaskForge creates its empty schema during API startup. Configure the server with:

  ```dotenv
  DATABASE_DRIVER=mysql
  DATABASE_URL=mysql://taskforge:URL_ENCODED_PASSWORD@127.0.0.1:3306/taskforge
  ```

- On the first deployment, temporarily set `ADMIN_EMAIL`, `ADMIN_PASSWORD` (at least 12 characters), and optionally `ADMIN_NAME`, then run `npm run admin:bootstrap`. Remove those bootstrap values after the command succeeds. Running it again safely rotates the matching human administrator's password.
- SQLite remains available for local development. Set `DATABASE_DRIVER=sqlite` and `DATABASE_PATH=./data/taskforge.db`; no MySQL service is needed.
- Database upgrades run as ordered, ledgered startup migrations. Back up production before upgrades and read row-level diagnostics before retrying a failed startup.
- Create and verify a workspace backup with `npm run backup:create -w @taskforge/api -- --output ./backups/taskforge-$(date +%Y%m%d-%H%M%S).tar.gz`; restore only to a stopped, disposable or explicitly approved target with `npm run backup:restore -w @taskforge/api -- --input ./backups/taskforge-YYYYMMDD-HHMMSS.tar.gz --force`.
- To exercise the same API suite against a dedicated empty MySQL database, run `TEST_DATABASE_URL=mysql://... npm run test:mysql -w @taskforge/api`. The test database is modified and must never point at production.
- Put the API behind TLS before issuing real credentials.

## Design choices

Humans receive short-lived JWTs because browser sessions benefit from expiration. Agents receive opaque tokens because automation credentials need simple bearer authentication, revocation, usage timestamps, and optional long expirations. Both resolve to the same user model and are subject to project membership checks, so the task API does not need separate human and agent behavior.

## Autonomous delivery handoff states

Smithy persists handoff evidence by `runId`. `IN_PROGRESS` with a pending handoff means work or recovery is active; a failed handoff exposes a redacted publication or credential error for retry. `PUBLISHED` records the pushed branch, head SHA, and pull-request metadata, and is required before `READY_FOR_REVIEW`. Restarts and reassignment reuse the existing branch and run evidence, while duplicate callbacks are safe to retry. Review approval and merge remain separate human-authorized steps; a successful provider run never implies `APPROVED` or `DONE`.

## Delivery Monitor

See the complete [Delivery Monitor operator runbook](docs/DELIVERY_MONITOR_RUNBOOK.md) for setup, recovery, and troubleshooting.

The Delivery Monitor is an optional worker that polls pull requests attached to tasks in the configured project workflow approval status (`agentWorkflow.approved`). It is deliberately separate from Smithy and uses a least-privilege GitHub App. Start it with `npm run dev:delivery-monitor`; run one poll with `npm run delivery-monitor:sync`.

Configuration is supplied through environment variables: `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, and `GITHUB_PRIVATE_KEY` (all three are required together), `DELIVERY_MONITOR_POLL_INTERVAL_MS` (default 60000, 5 seconds–15 minutes), `DELIVERY_MONITOR_BATCH_SIZE` (default 100, maximum 500), and `DELIVERY_MONITOR_LEASE_DURATION_MS` (default 120000). Credentials are never written to logs or TaskForge updates. Polling is disabled with `DELIVERY_MONITOR_ENABLED=false`.

The monitor accepts only `https://github.com/{owner}/{repository}/pull/{number}` URLs. A GitHub `merged_at` value maps to `DONE`; a closed, unmerged pull request maps to `CANCELLED`; open and draft requests remain in the approval workflow. Projects must explicitly enable both `DONE` and `CANCELLED` as available statuses before transitions are attempted.

The GitHub App needs repository **Metadata: read**, **Contents: read**, and **Pull requests: read** permissions, installed only on repositories being monitored. It does not need write, issue, workflow, or administration permissions. Operators see redacted error categories: `AUTHENTICATION`, `PERMISSION`, `RATE_LIMIT`, `NOT_FOUND`, `INVALID_URL`, `NETWORK`, `TIMEOUT`, and `UNKNOWN`. For disabled destination statuses, missing App installation, or malformed URLs, correct the project status configuration or installation and retry; never paste a token or private key into diagnostics.
