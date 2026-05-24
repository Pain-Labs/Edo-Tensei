# Claude Code Session

## Storage Paths

| OS | Path |
|---|---|
| Windows | `%USERPROFILE%\.claude\projects\{slug}\*.jsonl` |
| Linux / macOS | `~/.claude/projects/{slug}/*.jsonl` |

**Slug format**: workspace absolute path with slashes and colons replaced by `-`.  
- Windows: `C:\Users\user\MyProject` → `c--users-user-myproject` (colon becomes `--`, backslash becomes `-`)  
- Linux/macOS: `/home/user/myproject` → `-home-user-myproject`

Each project directory may contain multiple `.jsonl` files — each represents one session (Claude creates a new file when it compresses/rotates context).

## How to Find

```powershell
# Windows
$slug = (Get-Location).Path -replace '\\','-' -replace ':','-'
Get-ChildItem "$env:USERPROFILE\.claude\projects\*$slug*\*.jsonl" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 5
```

```bash
# Linux/macOS — list sessions for current directory, newest first
PROJECT_NAME=$(basename "$PWD")
ls -lt ~/.claude/projects/*${PROJECT_NAME}*/*.jsonl 2>/dev/null | head -5
```

## How to Read

Format: JSONL — one JSON object per line.

```jsonc
{
  "type": "user",            // or "assistant" (top-level type field, NOT message.role)
  "timestamp": "2026-05-01T12:00:00Z",
  "cwd": "/home/user/myproject",  // workspace path (present on some lines)
  "message": {
    "role": "user",
    "content": [
      { "type": "text", "text": "actual message content" },
      { "type": "thinking", "thinking": "extended thinking content" }
    ]
  }
}
```

**Filter by**: top-level `type === "user"` or `type === "assistant"`  
**Skip**: `type === "tool_use"`, `"tool_result"`, `"system"`, `"summary"`, `"summary_partial"`  
**Skip content items**: `type === "tool_result"` inside `message.content[]`  
**Include**: `type === "text"` and `type === "thinking"` content items  
**Note**: `<` and `>` characters are stripped from text content by the extractor  
**Note**: `cwd` field gives the actual workspace path — more reliable than inferring from slug

## Quick Handoff Command

```bash
# Most recent session for current project (Linux/macOS)
PROJECT_NAME=$(basename "$PWD")
ls -t ~/.claude/projects/*${PROJECT_NAME}*/*.jsonl 2>/dev/null | head -1
```
