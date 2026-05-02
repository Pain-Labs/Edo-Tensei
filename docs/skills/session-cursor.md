# Find Cursor IDE Session

## Purpose

Locate the most recent Cursor agent transcript file for a given project so another AI can resume context.

## Storage Paths

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Cursor\User\workspaceStorage\{hash}\agent-transcripts\{uuid}\*.jsonl` |
| Linux / macOS | `~/.config/Cursor/User/workspaceStorage/{hash}/agent-transcripts/{uuid}/*.jsonl` |

The `{hash}` folder corresponds to a workspace; each `{uuid}` subfolder under `agent-transcripts` is a single Composer session.

## How to Find

```bash
# Linux/macOS — find sessions related to current directory
CURRENT_DIR=$(pwd)
for wsdir in ~/.config/Cursor/User/workspaceStorage/*/; do
  if grep -q "$CURRENT_DIR" "$wsdir/workspace.json" 2>/dev/null; then
    echo "Workspace: $wsdir"
    # List agent transcripts newest first
    find "$wsdir/agent-transcripts" -name "*.jsonl" 2>/dev/null |
      xargs ls -t 2>/dev/null | head -5
    break
  fi
done

# Windows (PowerShell)
$currentDir = (Get-Location).Path
Get-ChildItem "$env:APPDATA\Cursor\User\workspaceStorage\*\workspace.json" |
  Select-String -Pattern [regex]::Escape($currentDir) -List |
  ForEach-Object {
    $wsDir = Split-Path $_.Path -Parent
    Get-ChildItem "$wsDir\agent-transcripts\*\*.jsonl" |
      Sort-Object LastWriteTime -Descending | Select-Object -First 5
  }
```

## How to Read

Format: JSONL — each line is a snapshot of the full conversation state.

**The last line contains the complete conversation history.** Read only the last line.

```bash
# Extract last turn from the last line of the most recent transcript
LATEST=$(find ~/.config/Cursor/User/workspaceStorage -name "*.jsonl" \
  -path "*/agent-transcripts/*" 2>/dev/null | xargs ls -t | head -1)

tail -1 "$LATEST" | python3 -c "
import sys, json
data = json.load(sys.stdin)
msgs = data.get('messages', [])
for m in msgs[-6:]:
    role = m.get('role', '?')
    text = (m.get('text') or m.get('message', {}).get('content', [''])[0] if isinstance(m.get('message', {}).get('content'), list) else '')
    print(f'[{role.upper()}]', str(text)[:300])
    print()
"
```

## Quick Handoff Command

```bash
# Path of the most recent agent transcript for current project (Linux)
CURRENT_DIR=$(pwd)
for wsdir in ~/.config/Cursor/User/workspaceStorage/*/; do
  if grep -q "$CURRENT_DIR" "$wsdir/workspace.json" 2>/dev/null; then
    find "$wsdir/agent-transcripts" -name "*.jsonl" 2>/dev/null | xargs ls -t | head -1
    break
  fi
done
```
