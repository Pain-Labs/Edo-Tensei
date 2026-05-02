# Find OpenAI Codex CLI Session

## Purpose

Locate the most recent Codex CLI session file so another AI can resume the task context.

## Storage Paths

| OS | Path |
|---|---|
| Linux / macOS | `~/.codex/sessions/rollout-*.jsonl` |
| Windows | `%USERPROFILE%\.codex\sessions\rollout-*.jsonl` |

Each `rollout-*.jsonl` file is one session. Newer sessions have higher rollout numbers or later modification times.

## How to Find

```bash
# Linux/macOS — list sessions newest first
ls -lt ~/.codex/sessions/rollout-*.jsonl 2>/dev/null | head -10

# Windows (PowerShell)
Get-ChildItem "$env:USERPROFILE\.codex\sessions\rollout-*.jsonl" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 10
```

## How to Read

Format: JSONL — each line has a `type` field and a `payload`.

Relevant `type` values: `"message"`, `"user_message"`, `"assistant_message"`, `"session_meta"`

```bash
# Show last 40 lines for recent context
tail -n 40 ~/.codex/sessions/rollout-<N>.jsonl

# Extract only user/assistant messages
grep -E '"type":"(user_message|assistant_message|message)"' \
  ~/.codex/sessions/rollout-<N>.jsonl | tail -20 | \
  python3 -c "
import sys, json
for line in sys.stdin:
    try:
        d = json.loads(line)
        role = d.get('type','?')
        text = d.get('payload', {}).get('content', '') or d.get('payload', {}).get('text', '')
        print(f'[{role}]', str(text)[:300])
        print()
    except: pass
"
```

## Quick Handoff Command

```bash
# Path of the most recent Codex session (Linux)
ls -t ~/.codex/sessions/rollout-*.jsonl 2>/dev/null | head -1
```
