# Claude Code instructions

Work from the repository root. Read `AGENTS.md` before editing, inspect existing patterns, and make the smallest complete change.

Use the existing TypeScript, React, Fastify, and migration conventions. Run typecheck, build, and relevant tests before handoff. Review the final diff for regressions, secrets, generated data, and unrelated edits.

TaskForge is provider-agnostic: `apps/api` never launches provider processes. Keep provider command execution and authentication in the optional Smithy runner, and redact all credentials and command output before persisting or reporting it.
