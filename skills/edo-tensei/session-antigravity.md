# Antigravity (Google Gemini Code Assist) Session

## Storage Paths

| OS | Path |
|---|---|
| Windows | `%USERPROFILE%\.gemini\antigravity\brain\{uuid}\.system_generated\logs\overview.txt` |
| Linux / macOS | `~/.gemini/antigravity/brain/{uuid}/.system_generated/logs/overview.txt` |

Each `{uuid}` directory is a separate brain/project. The `overview.txt` is a JSONL preview log.

## How to Find

```bash
# Linux/macOS — find all overview.txt files, newest first
find ~/.gemini/antigravity/brain -name "overview.txt" 2>/dev/null |
  xargs ls -t 2>/dev/null | head -5
```

```powershell
# Windows
Get-ChildItem "$env:USERPROFILE\.gemini\antigravity\brain\*\.system_generated\logs\overview.txt" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 5
```

## How to Read

Format: JSONL — each line is one event. Only two source values matter for conversation content.

### User messages

Filter: `source === "USER"` OR `source === "USER_EXPLICIT"` (both are real user input)

Extract from: `input` field → `content` field → `text` field (try in order)

**Important**: User content is sometimes wrapped in `<USER_REQUEST>...</USER_REQUEST>`. If present, extract only the content inside that tag and discard surrounding system metadata (`<ADDITIONAL_METADATA>`, `<USER_SETTINGS_CHANGE>`, etc.).

```jsonc
{
  "source": "USER",
  "input": "<USER_REQUEST>actual user message here</USER_REQUEST>",
  "created_at": "2026-05-01T12:00:00Z"
}
```

### Assistant messages

Filter: `source === "MODEL"` AND `type === "PLANNER_RESPONSE"` only

Two sub-cases:
1. Direct text: `content` or `text` field
2. Tool calls (Agent mode): look inside `tool_calls[]` for entries with `name === "reply"`, `"respond"`, `"send_message"`, or `"answer"` → extract `args.content` or `args.message` or `args.text`

```jsonc
// Case 1: direct text
{ "source": "MODEL", "type": "PLANNER_RESPONSE", "content": "..." }

// Case 2: tool call reply
{ "source": "MODEL", "type": "PLANNER_RESPONSE", "tool_calls": [{ "name": "reply", "args": { "content": "..." } }] }
```

## Known Limitation

Messages longer than ~900 characters are **truncated** with a marker like `<truncated N bytes>`. The complete conversation history is only available in Google Cloud. This overview.txt is a preview log only.
