# Database migrations

TaskForge applies an ordered, append-only migration registry when the API starts. Each successful migration is recorded in `schema_migrations` with its immutable version and application timestamp. Startup validates the ledger before changing the schema and refuses to continue when it contains an unknown version or a non-contiguous TaskForge migration history.

The current registry is:

1. `0001_core_schema`
2. `0002_legacy_columns`
3. `0003_expand_task_statuses`
4. `0004_project_status_defaults`
5. `0005_query_indexes`
6. `0006_security_audit_events` through `0015_fix_in_progress_status`
7. `0016_remove_ready_for_dev_status` (maps legacy `READY_FOR_DEV` tasks to `TODO`, removes it from project workflows, and rebuilds the status constraint)

`20260821_workflow_status_storage`, `20260821_workflow_system_default_guard`, and `20260822_task_statuses` are recognized markers written by startup migrations that preceded this registry. The first two can remain after the configurable-workflow rollout was cancelled. They are retained for upgrade compatibility but are not part of the ordered sequence.

## Runtime guarantees

- SQLite runs each migration and its ledger insert in one transaction. Table rebuilds disable foreign-key enforcement before the transaction, validate the rebuilt graph before commit, and always restore enforcement.
- MySQL 8 implicitly commits many DDL statements. MySQL migrations must therefore be idempotent and resumable; their ledger row is always the final operation. A failure can leave safe, recognizable schema work in place, but can never mark the migration applied. Startup holds a database-scoped advisory lock while validating and applying the registry.
- SQLite serializes each migration transaction, waits briefly for a competing writer, and rechecks the ledger inside the transaction before doing schema work.
- Destructive changes and table rebuilds must run a read-only preflight first. Diagnostics identify every offending row and the values an operator must repair; a count alone is not actionable.
- Re-running startup after a completed migration is a no-op. Never edit or reorder a migration that may have shipped.

The supported upgrade fixtures are an empty database, the pre-ledger five-status schema, and the `20260822_task_statuses` marker-era schema. CI runs fresh-install and direct-upgrade tests for every fixture on SQLite and MySQL 8. Adding support for another historical schema requires adding it to the cross-driver fixture matrix.

## Production rollout

1. Stop writes and take a restorable backup. For SQLite, stop the API and copy the database plus any `-wal` and `-shm` files together, or use SQLite's online `.backup` command. For MySQL, use a consistent `mysqldump --single-transaction` backup and verify that it can be restored to a disposable database.
2. Run the new API version on one instance first. Do not let multiple application versions migrate the same database concurrently.
3. Watch startup logs. The API is not ready until every pending migration has completed.
4. Verify the ordered ledger and exercise task creation, listing, and update flows before restoring normal traffic or rolling out more instances.
5. Retain the pre-upgrade backup through the observation window.

For MySQL, the migration account needs the DDL privileges required by the pending versions. Application instances may use a more restricted account after rollout if migrations are executed as a distinct deployment step.

## Failure and recovery

If preflight reports invalid rows, leave the API stopped, repair the listed task IDs and values using an audited data-fix, and restart the same application version. Do not insert a ledger row by hand.

If SQLite fails during a migration, its transaction rolls back. Resolve the reported cause and restart. If a process or host failure damages the database, restore the complete backup set.

If MySQL fails after partial DDL, keep the failed version deployed, inspect the schema and error, resolve the underlying problem, and restart. Its idempotent migration resumes the missing operations and records completion last. Restore the backup if the partial state cannot be reconciled safely.

An unknown ledger version usually means an older binary was started against a database migrated by a newer release. Deploy the matching or newer TaskForge release. A gap in the ordered history indicates a damaged or manually edited ledger; restore it from backup or recover with the release that created the history. Do not delete, rename, or fabricate migration rows.

## Adding a migration

Contributors should append one entry to the migration registry in `apps/api/src/db/database.ts` and add cross-driver tests that cover both a fresh database and each affected legacy fixture.

- Use a sortable, immutable version such as `0006_descriptive_name`.
- Make MySQL DDL safe to resume after any preceding statement.
- Put data validation before destructive DDL and include row IDs plus invalid values in errors.
- Write the ledger only after schema work and validation succeed; the runner owns this step.
- Test a deliberately failing path and prove its version is absent from the ledger.
- Update this document's registry and recovery notes when operational behavior changes.

Run the local SQLite gate with `npm test`. Run the MySQL matrix against a dedicated disposable database as described in [CI.md](CI.md); never point migration tests at production data.
