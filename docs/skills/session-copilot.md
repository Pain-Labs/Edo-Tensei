# Find GitHub Copilot Chat Session

## Purpose

Locate the most recent GitHub Copilot Chat session file so another AI agent can resume the task context.

## Storage Paths

| Environment | Path |
|---|---|
| Windows (VS Code local) | `%APPDATA%\Code\User\globalStorage\emptyWindowChatSessions\` |
| Windows (per-workspace) | `%APPDATA%\Code\User\workspaceStorage\{hash}\chatSessions\` |
| Linux / macOS (VS Code local) | `~/.config/Code/User/globalStorage/emptyWindowChatSessions/` |
| Linux (per-workspace) | `~/.config/Code/User/workspaceStorage/{hash}/chatSessions/` |
| VS Code Server (SSH remote) | `~/.vscode-server/data/User/globalStorage/emptyWindowChatSessions/` |
| VS Code Server (SSH, per-workspace) | `~/.vscode-server/data/User/workspaceStorage/{hash}/chatSessions/` |

Files are `.json` (older) or `.jsonl` (newer).

## How to Find

```bash
# Linux/macOS — global sessions, newest first
ls -lt ~/.config/Code/User/globalStorage/emptyWindowChatSessions/ 2>/dev/null | head -10

# VS Code Server (SSH remote) — global sessions
ls -lt ~/.vscode-server/data/User/globalStorage/emptyWindowChatSessions/ 2>/dev/null | head -10

# Find per-workspace sessions (search workspace.json for current directory)
CURRENT_DIR=$(pwd)
for wsdir in ~/.config/Code/User/workspaceStorage/*/; do
  if grep -q "$CURRENT_DIR" "$wsdir/workspace.json" 2>/dev/null; then
    echo "Found workspace storage: $wsdir"
    ls -lt "$wsdir/chatSessions/" 2>/dev/null | head -5
  fi
done

# Windows (PowerShell)
Get-ChildItem "$env:APPDATA\Code\User\globalStorage\emptyWindowChatSessions\" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 10
```

## How to Read

### JSON format (older)

```json
{
  "requests": [
    {
      "message": { "text": "<user message>" },
      "response": [ { "value": "<assistant response>" } ]
    }
  ]
}
```

### JSONL format (newer)

Each line: `{ "kind": <number>, "v": { "requests": [...] } }`

```bash
# Show the last session's requests summary
tail -c 50000 <path-to-session.json> | python3 -c "
import sys, json
data = json.load(sys.stdin)
for r in data.get('requests', [])[-5:]:
    print('USER:', r.get('message', {}).get('text', '')[:200])
    for resp in r.get('response', []):
        if resp.get('value'):
            print('ASST:', resp['value'][:200])
    print()
"
```

## Quick Handoff Command

```bash
# Most recent global session (Linux)
ls -t ~/.config/Code/User/globalStorage/emptyWindowChatSessions/*.{json,jsonl} 2>/dev/null | head -1

# Most recent global session (SSH remote)
ls -t ~/.vscode-server/data/User/globalStorage/emptyWindowChatSessions/*.{json,jsonl} 2>/dev/null | head -1
```
