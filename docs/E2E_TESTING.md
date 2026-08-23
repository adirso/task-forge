# Browser end-to-end testing

The browser suite lives in `e2e/` and runs against an isolated, freshly seeded SQLite workspace. The server harness removes `.e2e-data/`, runs the normal seed, starts the API on port 4400, and starts Vite on port 5174. It never uses the developer database or attachments directory.

Install the browser once, then run the maintained smoke suite from the repository root:

```bash
npm ci
npm run build -w @taskforge/contracts
npm run test:e2e:install
npm run test:e2e
```

Set `CI=1` to enable retries. Desktop and Pixel 7 projects cover login, project creation and status configuration, task creation/editing/status movement, board/list navigation, notes, attachments, and non-owner permissions. The mobile project additionally checks the responsive navigation shell and project/task entry points.

On failure, Playwright retains a trace, screenshot, and video for the failed test and writes an HTML report to `playwright-report/` (ignored from source control). Open it with `npx playwright show-report playwright-report`.

The CI browser job installs Chromium, runs `npm run test:e2e`, and uploads `playwright-report/` plus `test-results/` whenever the suite fails. Use accessible names and labels when extending tests; avoid CSS class selectors that describe presentation rather than user-visible behavior.
