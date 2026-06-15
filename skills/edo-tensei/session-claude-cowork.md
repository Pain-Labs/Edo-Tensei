# Claude.ai Cowork Session

## Storage Paths

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Claude/local-agent-mode-sessions/` |
| Linux | `~/.config/Claude/local-agent-mode-sessions/` |
| Windows | `%APPDATA%\Claude\local-agent-mode-sessions\` |

**Directory structure:**
```
local-agent-mode-sessions/
  {session-uuid}/              ← Cowork project/tab
    {conversation-uuid}/       ← specific conversation run
      agent/
        local_ditto_{conversation-uuid}/
          audit.jsonl          ← ✅ main transcript (read this)
      local_{child-uuid}/      ← child sub-sessions (spawned agents/tools)
        audit.jsonl
      local_{child-uuid}.json  ← child session metadata (title, cwd, timestamps)
      cowork-clientdata-cache.json
```

The **main transcript** is always at `agent/local_ditto_{conversation-uuid}/audit.jsonl`.  
Child `local_{uuid}/audit.jsonl` files contain individual tool-execution sub-sessions.

## How to Find

```bash
# macOS — list all sessions, newest first
ls -lt ~/Library/Application\ Support/Claude/local-agent-mode-sessions/

# List conversations inside a session (newest first)
SESSION_UUID="<paste-uuid>"
ls -lt ~/Library/Application\ Support/Claude/local-agent-mode-sessions/$SESSION_UUID/

# Get main transcript path for a conversation
CONV_UUID="<paste-uuid>"
echo ~/Library/Application\ Support/Claude/local-agent-mode-sessions/$SESSION_UUID/$CONV_UUID/agent/local_ditto_${CONV_UUID}/audit.jsonl
```

To find by **title**: child metadata `.json` files carry a `title` field:
```bash
grep -l '"title"' ~/Library/Application\ Support/Claude/local-agent-mode-sessions/*/*/*.json 2>/dev/null | \
  xargs -I{} python3 -c "import json,sys; d=json.load(open('{}'));print(d.get('lastActivityAt',''),d.get('title',''),'→','{}')" | \
  sort -r | head -10
```

## How to Read

Format: JSONL — one JSON object per line in `audit.jsonl`.

```jsonc
// User turn
{
  "type": "user",
  "message": { "role": "user", "content": "<string>" },
  "_audit_timestamp": "2026-06-15T10:00:00.000Z",
  "session_id": "...",
  "uuid": "..."
}

// Assistant turn
{
  "type": "assistant",
  "message": {
    "role": "assistant",
    "content": [
      { "type": "thinking", "thinking": "<reasoning>" },
      { "type": "text", "text": "<visible output>" }
    ],
    "usage": { "input_tokens": 0, "output_tokens": 0 }
  },
  "_audit_timestamp": "2026-06-15T10:00:01.000Z"
}

// Tool result (child session invocation)
{
  "type": "result",
  "subtype": "success",
  ...
}
```

**Filter by**: top-level `type === "user"` or `type === "assistant"`  
**Skip**: `type === "system"` (init/status/thinking_tokens/permission events), `type === "rate_limit_event"`, `type === "result"`  
**From user turns**: `message.content` — plain string (not an array)  
**From assistant turns**: `message.content[]` where `type === "text"` → `text`; optionally include `type === "thinking"` → `thinking`

## Child Sessions (MCP / Tool Call Analysis)

For analyzing tool call details (e.g. MCP server calls), read the child session files:

```bash
# List child sessions sorted by creation time
ls -lt ~/Library/Application\ Support/Claude/local-agent-mode-sessions/$SESSION_UUID/$CONV_UUID/*.json

# Read a child session's metadata (has title, cwd, model, MCP servers)
python3 -c "import json; print(json.dumps(json.load(open('<path>.json')), indent=2, ensure_ascii=False))" | head -60

# Read a child session's transcript
cat ~/Library/Application\ Support/Claude/local-agent-mode-sessions/$SESSION_UUID/$CONV_UUID/local_<child-uuid>/audit.jsonl
```

## Quick Handoff Command

```bash
# Newest session's newest conversation main transcript (macOS)
BASE=~/Library/Application\ Support/Claude/local-agent-mode-sessions
SESSION=$(ls -t "$BASE" | head -1)
CONV=$(ls -t "$BASE/$SESSION" | head -1)
echo "$BASE/$SESSION/$CONV/agent/local_ditto_${CONV}/audit.jsonl"
```
