# Continuous integration

GitHub Actions runs CI for every pull request and every push to `main`. Branch protection should require the three platform checks plus all four **Smithy provider matrix** checks before merging:

- **Quality and SQLite** installs the locked dependency graph, typechecks and builds every workspace, and runs every workspace test with the API's default SQLite database.
- **API on MySQL 8** runs the complete API suite against an ephemeral MySQL 8.4 service.
- **Browser E2E** launches an isolated seeded app and runs the desktop and Pixel 7 smoke flows for authentication, project/task editing, navigation, notes, attachments, and permission boundaries.
- **Smithy provider matrix (claude/codex/cursor/custom)** runs deterministic fake-provider integration tests without real provider binaries or credentials. Each matrix job verifies command defaults and argument boundaries, non-interactive streaming/redaction, timeout and missing-installation diagnostics, callback idempotency, and reusable isolated worktrees.

All jobs use Node.js 22 LTS and `npm ci`. The npm cache is keyed from `package-lock.json`; `node_modules` is never cached. The MySQL credentials are temporary values scoped to the job, so the workflow does not require repository secrets.

When a job fails, its command output and npm logs are uploaded for seven days. The MySQL job also captures the database service logs. Download `quality-sqlite-diagnostics` or `api-mysql-diagnostics` from the failed workflow run; Smithy matrix jobs use the test output directly because they do not start external services.

## Local equivalents

Run the quality and SQLite gate from the repository root:

```bash
npm ci
npm run typecheck
npm run build
npm test
```

Run the Browser E2E gate locally (Chromium is installed once, then reused):

```bash
npm run build -w @taskforge/contracts
npm run test:e2e:install
npm run test:e2e
```

Run the MySQL gate with Docker in a second terminal:

```bash
docker run --rm --name taskforge-ci-mysql \
  -e MYSQL_ROOT_PASSWORD=taskforge-ci-root \
  -e MYSQL_DATABASE=taskforge_test \
  -p 3306:3306 \
  mysql:8.4
```

Then run:

```bash
TEST_DATABASE_URL=mysql://root:taskforge-ci-root@127.0.0.1:3306/taskforge_test \
  npm run test:mysql -w @taskforge/api
```

Use only a dedicated, disposable database: the API suite creates, migrates, and modifies its schema.

Run the Smithy integration gate locally for every provider label:

```bash
for provider in claude codex cursor custom; do
  SMITHY_PROVIDER_LABEL="$provider" npm run test:integration -w @taskforge/smithy
done
```

Omit `SMITHY_PROVIDER_LABEL` to run all labels in one process. The tests use `apps/smithy/test/fixtures/fake-provider.mjs`, temporary PATH shims, and temporary Git repositories; no Claude, Codex, Cursor, API token, or webhook secret is required. See [the Smithy guide](SMITHY.md#troubleshooting-provider-integration-locally) for failure-specific troubleshooting.
