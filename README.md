# TaskForge

TaskForge is a local-first project and task manager for teams made of people and software agents. It combines a workflow board with a structured list, backed by a typed HTTP API.

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

## Quick start

Requirements: Node.js 22 or newer. CI uses Node.js 22 LTS.

```bash
npm install
cp .env.example .env
npm run db:seed
npm run dev
```

Open `http://127.0.0.1:5173` and use:

```text
Email:    demo@taskforge.local
Password: demo1234
```

SQLite is the default for local development and is created at `data/taskforge.db`. Seeding is idempotent and adds a sample project, people, an agent identity, and ten representative tasks.

## Workspace layout

```text
apps/
  api/        Fastify API, SQLite/MySQL schema, seed, integration tests
  web/        React/Vite client
packages/
  contracts/  Shared Zod validation and TypeScript domain types
docs/
  AGENT_API.md  Agent authentication and API examples
  CI.md         Required CI checks and local equivalents
```

## Commands

```bash
npm run dev        # API on :4000 and web app on :5173
npm run build      # Production builds for all workspaces
npm run typecheck  # Strict TypeScript checks
npm test           # Tests for every workspace
npm run db:seed    # Idempotent demo seed
npm run admin:bootstrap # Create or rotate the production administrator
```

## Continuous integration

Every pull request and push to `main` runs the required **Quality and SQLite** and **API on MySQL 8** checks. See the [CI guide](docs/CI.md) for their exact scope, local equivalents, and failure diagnostics.

## Dashboard examples

Home dashboard:

![TaskForge home dashboard example](docs/images/dashboard-example-home.png)

Board view:

![TaskForge board view example](docs/images/dashboard-example-board.png)

Send-to-AI dialog:

![TaskForge send to AI example](docs/images/dashboard-example-send-to-ai.png)

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
| `GET` | `/api/users` | List people and agents |
| `POST` | `/api/users/agents` | Create an agent identity (admin) |
| `POST/GET` | `/api/users/:id/tokens` | Issue or list token metadata |
| `DELETE` | `/api/users/tokens/:id` | Revoke a token |
| `GET` | `/api/notifications` | List notifications and unread count |
| `PATCH` | `/api/notifications/:id/read` | Mark one notification as read |
| `POST` | `/api/notifications/read-all` | Mark every notification as read |
| `GET` | `/api/search?q=...` | Search accessible tasks across projects |
| `GET` | `/api/context?project=TF&task=TF-4` | Resolve a shared project/task link without UUIDs |

See [Agent API guide](docs/AGENT_API.md) for copy-paste examples.

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
- Database upgrades run as ordered, ledgered startup migrations. Read the [database migration runbook](docs/DATABASE_MIGRATIONS.md) before production upgrades; it covers backups, staged rollout, failure diagnostics, and recovery.
- Create and verify a workspace backup with `npm run backup:create -w @taskforge/api -- --output ./backups/taskforge-$(date +%Y%m%d-%H%M%S).tar.gz`; restore only to a stopped, disposable or explicitly approved target with `npm run backup:restore -w @taskforge/api -- --input ./backups/taskforge-YYYYMMDD-HHMMSS.tar.gz --force`. See the [backup and restore runbook](docs/BACKUP_RESTORE.md).
- To exercise the same API suite against a dedicated empty MySQL database, run `TEST_DATABASE_URL=mysql://... npm run test:mysql -w @taskforge/api`. The test database is modified and must never point at production.
- Put the API behind TLS before issuing real credentials.

## Design choices

Humans receive short-lived JWTs because browser sessions benefit from expiration. Agents receive opaque tokens because automation credentials need simple bearer authentication, revocation, usage timestamps, and optional long expirations. Both resolve to the same user model and are subject to project membership checks, so the task API does not need separate human and agent behavior.
