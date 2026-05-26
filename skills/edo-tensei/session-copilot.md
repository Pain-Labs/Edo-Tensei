# GitHub Copilot Chat Session

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

# Find per-workspace sessions
CURRENT_DIR=$(pwd)
for wsdir in ~/.config/Code/User/workspaceStorage/*/; do
  if grep -q "$CURRENT_DIR" "$wsdir/workspace.json" 2>/dev/null; then
    echo "Found workspace storage: $wsdir"
    ls -lt "$wsdir/chatSessions/" 2>/dev/null | head -5
  fi
done
```

```powershell
# Windows
Get-ChildItem "$env:APPDATA\Code\User\globalStorage\emptyWindowChatSessions\" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 10
```

## How to Read

### JSON format (older .json files)

Root has `requests[]`. Each request has a user message and assistant response:

```json
{
  "sessionId": "...",
  "requests": [
    {
      "message": { "text": "<user message>" },
      "response": [ { "value": "<assistant response>" } ]
    }
  ]
}
```

Extract: `requests[].message.text` (user) and `requests[].response[].value` (assistant, filter out parts with `kind` set).

### JSONL format (newer .jsonl files) — TWO sub-formats

**Old JSONL format**: `kind=0` lines contain full session snapshots. Take the last one per sessionId.

```jsonc
// Each line:
{ "kind": 0, "v": { "sessionId": "...", "customTitle": "...", "requests": [ ...full array... ] } }
```

**New JSONL format** (since ~2025): `kind=0` line has an **empty** `requests` array. Real data is in `kind=2` lines.

```jsonc
// kind=0: session header (requests is EMPTY)
{ "kind": 0, "v": { "sessionId": "...", "requests": [] } }

// kind=2 k="requests": each line appends ONE request (cumulative, not replacing)
{ "kind": 2, "k": "requests", "v": [ { "message": { "text": "..." }, "response": [] } ] }
// or k as array:
{ "kind": 2, "k": ["requests"], "v": [ ... ] }

// kind=2 k=["requests", N, "response"]: patches the response for turn N
{ "kind": 2, "k": ["requests", 0, "response"], "v": [ { "value": "..." } ] }
```

To reconstruct new format:
1. Collect all `kind=2` lines where `k === "requests"` or `k === ["requests"]` → concatenate `v` arrays
2. Collect all `kind=2` lines where `k === ["requests", N, "response"]` → apply as patches
3. Parse the merged requests array like the old format

## Quick Handoff Command

```bash
# Most recent global session (Linux)
ls -t ~/.config/Code/User/globalStorage/emptyWindowChatSessions/*.{json,jsonl} 2>/dev/null | head -1
```
