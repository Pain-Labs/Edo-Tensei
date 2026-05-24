# Cursor Session

## Storage Paths

| OS | Path |
|---|---|
| Windows | `%USERPROFILE%\.cursor\projects\{slug}\agent-transcripts\{uuid}\{uuid}.jsonl` |
| Linux / macOS | `~/.cursor/projects/{slug}/agent-transcripts/{uuid}/{uuid}.jsonl` |

**Slug format**: workspace absolute path with lowercase drive letter + dashes (single dash for all separators).  
e.g. `C:\Users\user\MyProject` → `c-Users-user-MyProject`  
e.g. `/home/user/myproject` → `-home-user-myproject`

Note: This is different from Claude Code's double-dash slug format.

Each `{uuid}` directory contains exactly one `{uuid}.jsonl` file (same name as the directory).

## How to Find

```powershell
# Windows — list projects newest first, then their agent transcripts
Get-ChildItem "$env:USERPROFILE\.cursor\projects" -Directory |
  Sort-Object LastWriteTime -Descending | Select-Object -First 5 |
  ForEach-Object {
    Get-ChildItem "$($_.FullName)\agent-transcripts\*\*.jsonl" |
      Sort-Object LastWriteTime -Descending | Select-Object -First 2
  }
```

```bash
# Linux/macOS — find most recent transcript for current project
PROJECT_SLUG=$(pwd | tr '/:' '-' | sed 's/^./\L&/')
ls -lt ~/.cursor/projects/${PROJECT_SLUG}/agent-transcripts/*/*.jsonl 2>/dev/null | head -5
```

## How to Read

Format: JSONL — each line is a JSON object.

```json
{"role":"user","message":{"content":[{"type":"text","text":"..."}]}}
{"role":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
```

- Filter by `role === "user"` or `role === "assistant"`
- Extract text from `message.content[].text` where `type === "text"`
- Each line is one message (not a full snapshot)
- Read from the end of the file for the most recent turns

## Quick Handoff Command

```bash
# Most recent transcript for current project (Linux/macOS)
PROJECT_SLUG=$(pwd | sed 's|^/||' | tr '/' '-' | tr '[:upper:]' '[:lower:]')
ls -t ~/.cursor/projects/${PROJECT_SLUG}/agent-transcripts/*/*.jsonl 2>/dev/null | head -1
```
