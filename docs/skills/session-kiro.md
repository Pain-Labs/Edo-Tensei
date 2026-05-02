# Find Kiro Session

## Purpose

Locate the most recent Kiro agent session file so another AI can resume context.

## Storage Paths

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Kiro\User\globalStorage\kiro.kiroagent\{hash}\*.chat` |
| Linux / macOS | `~/.config/Kiro/User/globalStorage/kiro.kiroagent/{hash}/*.chat` |

Each `{hash}` folder corresponds to a workspace. Files are JSON.

## How to Find

```bash
# Windows (PowerShell)
Get-ChildItem "$env:APPDATA\Kiro\User\globalStorage\kiro.kiroagent\*\*.chat" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 5

# Linux/macOS
ls -lt ~/.config/Kiro/User/globalStorage/kiro.kiroagent/*/*.chat 2>/dev/null | head -5
```

## How to Read

Format: JSON with a `chat` array.

```json
{
  "chat": [
    { "role": "user", "content": "..." },
    { "role": "bot", "content": "..." }
  ]
}
```

Role values: `"user"` / `"human"`, `"bot"` / `"assistant"`, `"tool"`.

## Quick Handoff Command

```bash
# Most recent Kiro session (Linux)
ls -t ~/.config/Kiro/User/globalStorage/kiro.kiroagent/*/*.chat 2>/dev/null | head -1
```
