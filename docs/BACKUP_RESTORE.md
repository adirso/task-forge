# Workspace backup and restore

TaskForge backups are version-1 `tar.gz` archives containing a database snapshot, the attachment files referenced by that snapshot, and `manifest.json`. The manifest records the database driver, migration versions, attachment keys, and a SHA-256 checksum and byte size for every payload file.

## Create a backup

Run the command against the stopped or normally running instance:

```bash
npm run backup:create -w @taskforge/api -- \
  --output ./backups/taskforge-$(date +%Y%m%d-%H%M%S).tar.gz
```

SQLite uses the engine's online backup API, so the database image is transactionally consistent while the service is serving requests. MySQL uses a repeatable-read transaction while exporting every application table. Attachments are copied only after their database rows are read; a missing or unsafe storage key fails the backup instead of producing an incomplete archive.

By default, backups redact human password hashes, webhook URLs and encrypted webhook secrets, and omit API-token rows. Restoring this default archive recreates the user identities but requires passwords and agent tokens to be bootstrapped or reissued. If a protected archive is explicitly required, use `--include-secrets`, restrict its filesystem permissions, encrypt it with your organization's key-management tooling, and treat it as equivalent to production credentials:

```bash
npm run backup:create -w @taskforge/api -- \
  --output ./backups/taskforge-secure.tar.gz --include-secrets
```

The backup command refuses to overwrite an existing output path. Store archives outside the application directory and verify that the archive can be read before copying it off-host.

## Restore safely

Restore to a stopped, empty instance whenever possible. The command validates the archive version, allowed migration versions, tar paths, every manifest checksum, SQLite integrity (for SQLite archives), and attachment/database consistency before changing the target:

```bash
npm run backup:restore -w @taskforge/api -- \
  --input ./backups/taskforge-20260823-160000.tar.gz --force
```

`--force` is required when replacing an existing SQLite database or attachment directory, or a MySQL database that already contains users. The restore stages attachments and database data first. SQLite swaps the database image and attachment directory with rollback paths; MySQL restores rows in one transaction and rolls the attachment swap back if the transaction fails. A corrupt archive, missing attachment, checksum mismatch, unsupported format, unknown migration version, or failed import leaves the existing target untouched.

For MySQL, `DATABASE_URL` must identify the target database and the account must have the schema/data privileges used by the migration runner. The target is migrated to the current schema before rows are restored. For SQLite, `DATABASE_PATH` and `ATTACHMENTS_PATH` identify the target paths. Do not restore over a live API process: stop it first, restore, run health and representative read checks, then start it again.

After restore, verify:

1. `GET /health` returns `200`.
2. Projects, tasks, notes, users, and attachment downloads are present.
3. `schema_migrations` contains the expected versions.
4. Redacted archives have had human passwords and agent tokens re-established through the normal bootstrap/rotation flows.

Keep the pre-restore database and attachment rollback paths until these checks and a normal backup have succeeded. Never edit `manifest.json`, migration rows, or checksums to force an archive through validation.

Round-trip tests live in `apps/api/test/backup.test.ts` and cover representative data, redaction and explicit secure mode, missing files, corrupted archives, and failed recovery without partial overwrite. Run `npm test` for SQLite; set `TEST_DATABASE_URL` to a disposable MySQL 8 database to include the MySQL round-trip.
