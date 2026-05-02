# Find Claude Code Session

## Purpose

Locate the most recent Claude Code session file for a given project directory so you can read its context and resume work.

## Storage Paths

| OS | Path |
|---|---|
| Linux / macOS | `~/.claude/projects/{slug}/*.jsonl` |
| Windows | `%USERPROFILE%\.claude\projects\{slug}\*.jsonl` |
| VS Code Server (SSH remote) | `~/.claude/projects/{slug}/*.jsonl` (on the remote host) |

### Slug Format

Claude Code converts the workspace absolute path into a slug:

- **Linux/macOS**: `/home/user/myproject` → `-home-user-myproject`
- **Windows**: `C:\Users\user\myproject` → `c--users-user-myproject`

Each project directory may contain multiple `.jsonl` files — each represents one session (Claude creates a new file when it compresses/rotates context).

## How to Find

```bash
# Linux/macOS — list sessions for current directory, newest first
PROJECT_SLUG=$(pwd | tr '/' '-')
ls -lt ~/.claude/projects/${PROJECT_SLUG}/*.jsonl 2>/dev/null | head -5

# If the above finds nothing, try a fuzzy match (project name only)
PROJECT_NAME=$(basename "$PWD")
ls -lt ~/.claude/projects/*${PROJECT_NAME}*/*.jsonl 2>/dev/null | head -5

# Windows (PowerShell)
$slug = (Get-Location).Path -replace '\\','-' -replace ':','-'
Get-ChildItem "$env:USERPROFILE\.claude\projects\*$slug*\*.jsonl" | Sort-Object LastWriteTime -Descending | Select-Object -First 5
```

## How to Read

Format: JSONL (one JSON object per line)

```bash
# Show last 30 lines (most recent turns)
tail -n 30 <path-to-session.jsonl>
```

Relevant fields per line:

- `"type": "user"` or `"type": "assistant"` — conversation turns
- `"message.content[].text"` — the actual text
- Skip lines where `type` is `tool_use`, `tool_result`, `system`, or `summary`

## Quick Handoff Command

```bash
# Get path of the single most recent session for current project
PROJECT_NAME=$(basename "$PWD")
LATEST=$(ls -t ~/.claude/projects/*${PROJECT_NAME}*/*.jsonl 2>/dev/null | head -1)
echo "Latest Claude session: $LATEST"
```
