# OpenAI Codex CLI Session

## Storage Paths

| OS | Path |
|---|---|
| Windows | `%USERPROFILE%\.codex\sessions\rollout-*.jsonl` |
| Linux / macOS | `~/.codex/sessions/rollout-*.jsonl` |

Each `rollout-*.jsonl` file is one session. Newer sessions have later modification times.

## How to Find

```bash
# Linux/macOS — list sessions newest first
ls -lt ~/.codex/sessions/rollout-*.jsonl 2>/dev/null | head -10
```

```powershell
# Windows
Get-ChildItem "$env:USERPROFILE\.codex\sessions\rollout-*.jsonl" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 10
```

## How to Read

Format: JSONL — each line has a `type` field and a `payload`.

### Relevant `type` values

- `session_meta` → `payload.cwd` (workspace path) and `payload.id` (session ID)
- `response_item` → actual conversation messages (when `payload.type === "message"`)

> ⚠️ `"message"`, `"user_message"`, `"assistant_message"` are NOT valid type values in Codex JSONL.

### Extracting messages from `response_item`

```jsonc
{
  "type": "response_item",
  "payload": {
    "type": "message",
    "role": "user",          // or "assistant" | "developer" | "system"
    "content": [
      { "type": "text", "text": "..." },
      { "input_text": "..." }  // alternative field name
    ]
  }
}
```

Extract text from `payload.content[].text` or `payload.content[].input_text`.

### Filtering injected messages

Codex injects several message types that are NOT real user input — skip them:

- `role === "developer"` or `role === "system"` → always skip
- `role === "user"` starting with `<permissions instructions>`, `<collaboration_mode>`, `<skills_instructions>`, `<environment_context>`, or `# AGENTS.md instructions for` → skip
- `role === "user"` starting with `# Context from my IDE setup:` → extract ONLY the text after `## My request for Codex:` marker

## Quick Handoff Command

```bash
# Path of the most recent Codex session (Linux)
ls -t ~/.codex/sessions/rollout-*.jsonl 2>/dev/null | head -1
```
