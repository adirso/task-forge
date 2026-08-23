# Continuous integration

GitHub Actions runs CI for every pull request and every push to `main`. Branch protection should require all three checks before merging:

- **Quality and SQLite** installs the locked dependency graph, typechecks and builds every workspace, and runs every workspace test with the API's default SQLite database.
- **API on MySQL 8** runs the complete API suite against an ephemeral MySQL 8.4 service.
- **Browser E2E** launches an isolated seeded app and runs the desktop and Pixel 7 smoke flows for authentication, project/task editing, navigation, notes, attachments, and permission boundaries.

All jobs use Node.js 22 LTS and `npm ci`. The npm cache is keyed from `package-lock.json`; `node_modules` is never cached. The MySQL credentials are temporary values scoped to the job, so the workflow does not require repository secrets.

When a job fails, its command output and npm logs are uploaded for seven days. The MySQL job also captures the database service logs. Download `quality-sqlite-diagnostics` or `api-mysql-diagnostics` from the failed workflow run.

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
