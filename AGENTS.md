# TaskForge contributor guide

## Development

- Use Node.js 22 or newer and npm 10 or newer.
- Run `npm ci`, then `npm run typecheck`, `npm run build`, and `npm test` before opening a pull request.
- Keep changes focused and preserve unrelated worktree files.
- Add regression tests for behavior changes. Persistence changes must work with SQLite and MySQL where applicable.
- Every pull request targeting `main` or `master` must bump the root project version in `package.json` and `package-lock.json`. The version guard CI check compares the proposed version with the target branch and blocks unchanged or lower versions.

## Architecture

- Keep request parsing in Fastify routes, business rules in application services, and SQL/row mapping in repositories.
- Keep provider execution in the optional `apps/smithy` runner; the API must remain provider-agnostic.
- Use the versioned migration registry for schema changes. Never edit the migration ledger manually.

## Security

- Never commit credentials, tokens, webhook secrets, database files, or private repository paths.
- Redact secrets from updates, agent logs, test fixtures, and error messages.
- Preserve authorization checks and validate project status configuration before persistence.
