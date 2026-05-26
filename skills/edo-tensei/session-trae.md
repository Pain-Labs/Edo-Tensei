# Trae Session

## Storage Paths

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Trae\User\globalStorage\.ckg\storage\{hash}\*_codekg.db` |

> ⚠️ **Format: SQLite binary database** — Trae stores sessions in `.db` files. The extractor is currently **disabled** due to garbled output from encoding issues. Direct reading is not supported.

## Known Limitation

Trae sessions are stored in SQLite format which requires native bindings not available in all environments. The current extractor implementation attempts heuristic binary string extraction but cannot reliably distinguish user vs assistant roles.

For reliable handoff, ask the user to paste the relevant conversation turns manually.

## Fallback Message

When Trae sessions are requested, output:

> I found the Trae session database at the path above, but it's in SQLite binary format and cannot be reliably parsed in this environment. Please paste the last few turns from your Trae conversation, or describe what was being worked on.
