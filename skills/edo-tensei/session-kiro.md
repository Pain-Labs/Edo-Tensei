# Kiro Session

## Storage Paths

Kiro has two session formats. Format B (newer) takes priority as it includes workspace path.

### Format B — workspace-sessions (newer, preferred)

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Kiro\User\globalStorage\kiro.kiroagent\workspace-sessions\{Base64URL(path)}\{uuid}.json` |
| Linux / macOS | `~/.config/Kiro/User/globalStorage/kiro.kiroagent/workspace-sessions/{Base64URL(path)}/{uuid}.json` |

Folder name is the Base64URL-encoded absolute workspace path. The JSON file itself contains `workspaceDirectory` with the actual path, so decoding is not needed.

### Format A — legacy .chat files (older)

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Kiro\User\globalStorage\kiro.kiroagent\{hex32}\*.chat` |
| Linux / macOS | `~/.config/Kiro/User/globalStorage/kiro.kiroagent/{hex32}/*.chat` |

`{hex32}` is a 32-character hex hash. No workspace path info in Format A.

## How to Find

```powershell
# Windows — Format B (newest first)
Get-ChildItem "$env:APPDATA\Kiro\User\globalStorage\kiro.kiroagent\workspace-sessions\*\*.json" |
  Where-Object { $_.Name -ne 'sessions.json' } |
  Sort-Object LastWriteTime -Descending | Select-Object -First 5

# Windows — Format A fallback
Get-ChildItem "$env:APPDATA\Kiro\User\globalStorage\kiro.kiroagent\*\*.chat" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 5
```

```bash
# Linux/macOS — Format B
find ~/.config/Kiro/User/globalStorage/kiro.kiroagent/workspace-sessions -name "*.json" \
  ! -name "sessions.json" 2>/dev/null | xargs ls -t | head -5
```

## How to Read

### Format B JSON structure

```json
{
  "workspaceDirectory": "C:\\Users\\username\\Projects\\my-project",
  "history": [
    {
      "executionId": "...",
      "message": {
        "role": "user",
        "content": [{ "type": "text", "text": "..." }]
      }
    },
    {
      "executionId": "...",
      "message": {
        "role": "assistant",
        "content": "On it."
      }
    }
  ]
}
```

- `content` can be a string OR `ContentPart[]` with `{ "type": "text", "text": "..." }`
- Assistant replies in Agent mode are often just `"On it."` — the real tool execution lives in a separate execution graph file; for handoff purposes, focus on user messages
- Use `workspaceDirectory` for workspace path matching

### Format A JSON structure (.chat files)

```json
{
  "chat": [
    { "role": "user", "content": "..." },
    { "role": "bot", "content": "..." }
  ]
}
```

Valid role values: `"user"`, `"human"`, `"bot"`, `"assistant"`, `"tool"`

**Skip**: `role === "tool"` (tool results, not conversation content)  
**Skip**: bot/assistant messages that are only `"On it."`, `"Understood."`, or `"I will follow these instructions."`  
**Skip**: user messages starting with `# System Prompt` or `<identity>` (system injections)  
**Strip**: `<EnvironmentContext>...</EnvironmentContext>`, `<OPEN-EDITOR-FILES>...</OPEN-EDITOR-FILES>`, `<ACTIVE-EDITOR-FILE>...</ACTIVE-EDITOR-FILE>` blocks from user messages
