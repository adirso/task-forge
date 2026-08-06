# TaskForge

TaskForge is a local-first project and task manager for teams made of people and software agents. It combines a Jira-style workflow board with a Monday-style structured list, backed by a typed HTTP API.

## What is included

- Human login with 8-hour JWT sessions
- Agent identities with hashed, revocable, optionally expiring API tokens
- Project ownership, membership, repository links, keys, colors, and descriptions
- Tasks with a stable project number, description, definition of done, workflow status, priority, assignee, creator, branch, pull request, parent task, due date, estimate, and ordering
- Chronological task notes and progress updates authored by people or agents
- Numbered project phases with goals, one active phase for the board, and phase-grouped list planning
- Five-column drag-and-drop board and sortable-feeling structured list view
- Current-project filtering plus cross-project task search with `⌘K`
- Persistent notifications for assignments and review requests, with unread state and direct task navigation
- Working settings for account details, default view, text size, agent identities, and API-token lifecycle management
- Shareable `?project=KEY&task=KEY-N` deep links for people and agents
- SQLite persistence, validation, project access checks, activity records, and cascade-safe nested tasks
- Interactive API documentation at `http://127.0.0.1:4000/docs/`

## Quick start

Requirements: Node.js 20 or newer.

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

The database is created at `data/taskforge.db`. Seeding is idempotent and adds a sample project, people, an agent identity, and ten representative tasks.

## Workspace layout

```text
apps/
  api/        Fastify API, SQLite schema, seed, integration tests
  web/        React/Vite client
packages/
  contracts/  Shared Zod validation and TypeScript domain types
docs/
  AGENT_API.md  Agent authentication and API examples
```

## Commands

```bash
npm run dev        # API on :4000 and web app on :5173
npm run build      # Production builds for all workspaces
npm run typecheck  # Strict TypeScript checks
npm test           # API integration tests
npm run db:seed    # Idempotent demo seed
```

## API overview

All application endpoints are under `/api`. Send either a human JWT or agent token as `Authorization: Bearer <credential>`.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Exchange human credentials for a JWT |
| `GET` | `/api/auth/me` | Resolve the current identity |
| `GET/POST` | `/api/projects` | List or create projects |
| `GET/PATCH` | `/api/projects/:id` | Read or update a project |
| `POST` | `/api/projects/:id/members` | Add a person or agent to a project |
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
- SQLite WAL mode is a good fit for a single service instance. For multi-instance deployment, move the same schema to PostgreSQL and keep the contracts/API boundary.
- Put the API behind TLS before issuing real credentials.

## Design choices

Humans receive short-lived JWTs because browser sessions benefit from expiration. Agents receive opaque tokens because automation credentials need simple bearer authentication, revocation, usage timestamps, and optional long expirations. Both resolve to the same user model and are subject to project membership checks, so the task API does not need separate human and agent behavior.
