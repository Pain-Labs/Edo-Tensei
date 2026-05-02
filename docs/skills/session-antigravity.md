# Find Gemini Code Assist (Antigravity) Session

## Purpose

Locate the most recent Gemini Code Assist (formerly Antigravity) session log. Note: the log is **truncated at ~900 characters per message** — full history is stored in Google Cloud only.

## Storage Paths

| OS | Path |
|---|---|
| Linux / macOS | `~/.gemini/antigravity/brain/{uuid}/.system_generated/logs/overview.txt` |
| Windows | `%USERPROFILE%\.gemini\antigravity\brain\{uuid}\.system_generated\logs\overview.txt` |

Each `{uuid}` directory is a separate brain/project. The `overview.txt` file is a JSONL log of conversation turns.

## How to Find

```bash
# Linux/macOS — find all overview.txt files, newest first
find ~/.gemini/antigravity/brain -name "overview.txt" 2>/dev/null |
  xargs ls -t 2>/dev/null | head -5

# Match to current project (by directory name)
PROJECT_NAME=$(basename "$PWD")
find ~/.gemini/antigravity/brain -name "overview.txt" 2>/dev/null |
  xargs grep -l "$PROJECT_NAME" 2>/dev/null | head -3

# Windows (PowerShell)
Get-ChildItem "$env:USERPROFILE\.gemini\antigravity\brain\*\.system_generated\logs\overview.txt" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 5
```

## How to Read

Format: JSONL — each line represents one conversation turn.

```bash
# Show last 20 turns
tail -n 20 ~/.gemini/antigravity/brain/{uuid}/.system_generated/logs/overview.txt | \
  python3 -c "
import sys, json
for line in sys.stdin:
    try:
        d = json.loads(line.strip())
        source = d.get('source', '?')
        text = d.get('input') or d.get('content') or ''
        print(f'[{source}]', str(text)[:400])
        print()
    except: pass
"
```

## Known Limitation

Messages longer than ~900 characters are **truncated** with a marker like `<truncated N bytes>`. The complete conversation history is only available in Google Cloud (your Google account). This session file is a preview log only.
