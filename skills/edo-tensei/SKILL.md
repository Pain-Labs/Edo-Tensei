---
name: edo-tensei
description: Transfers local AI session context across Claude Code, Claude.ai Cowork, Copilot, Cursor, Kiro, Windsurf, Trae, Antigravity, and Codex on Windows. Use when the user wants to continue work from another AI tool, summarize a recent session, or generate a structured handoff prompt without requiring VS Code or MCP.
---

# Edo Tensei

Use this skill to take over work from another AI IDE, or recover the latest session context without manually pasting the whole conversation.

This skill works directly via file system access — no VS Code extension or MCP server required.

**Public support scope:** Windows only. macOS and Linux paths below are retained as reference material, but they are not part of the current acceptance matrix.

## Primary Goal

Find the most relevant recent session file for the current project, read it selectively, and return a concise handoff summary:

- Goal
- Completed / attempted steps
- Current blocker
- Proposed next steps

## Output Contract

Always return:

```
## Session Handoff Summary
**Source IDE**: <ide>
**Session Path**: <path>
**Last Activity**: <timestamp>

### Goal
<1-2 sentences>

### Completed / Attempted
- <item>

### Current Blocker
<description or "None">

### Proposed Next Steps
- [ ] <actionable item>
```

If the user asks for Chinese, output the same structure in Chinese.

---

## Layer 0: Scope Gate

Before reading any large file:

1. Confirm the current working directory / workspace name.
2. Prefer the most recent 20% of a session or the last 60–250 lines/messages.
3. Filter to human-facing turns only:
   - `role === "user"` or `role === "assistant"`
   - content blocks with `type === "text"`
4. Skip tool-call noise unless it explains the blocker.

### Selection and Stop Rules

1. If the user names an IDE, search only that IDE unless they explicitly allow fallback.
2. Within the allowed IDE set, match the current workspace by normalized absolute path before considering modification time. Exact normalized absolute path matches always win; do not select a globally newer session from another project.
3. If no exact path match exists and the current workspace is a Git worktree, compare the canonical Git common directory for the current workspace and candidate workspace paths that still exist. Use this only as a repository-level fallback; never use a remote URL alone as repository identity.
4. If exactly one candidate workspace shares the current Git common directory, select its newest session and state that the exact workspace path was not found and repository-level fallback was used.
5. If multiple candidate workspaces share the current Git common directory, list the candidates and ask the user to choose. Do not guess based on modification time.
6. If multiple candidates have the same basename but different absolute workspace paths and Git identity cannot resolve them, show the candidates and ask the user to choose. Do not guess.
7. If the source is binary, encrypted, locked, or blocked by permissions and the documented reader cannot access it, report the exact path and limitation, then stop. Do not invent content, silently switch projects, or attempt unsafe permission changes.
8. If no candidate can be tied to the current workspace with reasonable confidence, return a concise “no matching session” result and list the paths checked.

### Git Worktree Identity Fallback (Windows)

Use read-only Git discovery only after exact-path matching fails:

```powershell
$workspacePath = (Get-Location).Path
$commonDirOutput = git -C $workspacePath rev-parse --path-format=absolute --git-common-dir 2>$null
if ($LASTEXITCODE -eq 0 -and $commonDirOutput) {
  $canonicalCommonDir = [System.IO.Path]::GetFullPath($commonDirOutput.Trim())
}
```

Run the same command only for candidate workspace paths that still exist. Normalize case and directory separators before comparison on Windows. Do not write to either worktree, alter Git configuration, create branches, or treat an inaccessible/deleted candidate path as a match.

---

## Layer 1: Search Strategy

Search the target IDE first if the user specified one. Otherwise try in this order:

1. Claude Code
2. Claude.ai Cowork
3. GitHub Copilot
4. Cursor
5. OpenAI Codex CLI
6. Kiro
7. Windsurf
8. Trae
9. Antigravity

### Claude Code

**Paths**

| OS | Path |
|---|---|
| Windows | `%USERPROFILE%\.claude\projects\{slug}\*.jsonl` |
| Linux / macOS | `~/.claude/projects/{slug}/*.jsonl` |

Slug: workspace absolute path with slashes/colons replaced by `-`  
e.g. `C:\Users\user\myproject` → `c--users-user-myproject`

**Find**

```powershell
# Windows
$slug = (Get-Location).Path -replace '\\','-' -replace ':','-'
Get-ChildItem "$env:USERPROFILE\.claude\projects\*$slug*\*.jsonl" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 5
```

```bash
# Linux/macOS
PROJECT_NAME=$(basename "$PWD")
ls -lt ~/.claude/projects/*${PROJECT_NAME}*/*.jsonl 2>/dev/null | head -5
```

**Read**: JSONL — filter by top-level `type === "user"` or `"assistant"`. Extract `message.content[].text` (skip `tool_result` items) and `message.content[].thinking` (reasoning). `cwd` field on some lines gives the actual workspace path. Full details: [session-claude.md](session-claude.md)

---

### Claude.ai Cowork

**Paths**

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Claude/local-agent-mode-sessions/` |
| Linux | `~/.config/Claude/local-agent-mode-sessions/` |
| Windows | `%APPDATA%\Claude\local-agent-mode-sessions\` |

Structure: `{session-uuid}/{conversation-uuid}/agent/local_ditto_{conversation-uuid}/audit.jsonl`  
Session metadata (title, cwd, timestamps): `{conversation-uuid}/local_{child-uuid}.json`  
Child sub-sessions (tool/MCP calls): `{conversation-uuid}/local_{child-uuid}/audit.jsonl`

**Find**

```bash
# macOS — newest session → newest conversation → main transcript path
BASE=~/Library/Application\ Support/Claude/local-agent-mode-sessions
SESSION=$(ls -t "$BASE" | head -1)
CONV=$(ls -t "$BASE/$SESSION" | head -1)
echo "$BASE/$SESSION/$CONV/agent/local_ditto_${CONV}/audit.jsonl"
```

**Read**: JSONL — filter by top-level `type === "user"` or `type === "assistant"`.  
User: `message.content` is a plain **string**.  
Assistant: `message.content[]` array — extract `type === "text"` → `text`; optionally `type === "thinking"` → `thinking`.  
Skip: `type === "system"`, `"rate_limit_event"`, `"result"`.  
Timestamps on `_audit_timestamp` field. Full details: [session-claude-cowork.md](session-claude-cowork.md)

---

### GitHub Copilot

**Paths**

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Code\User\globalStorage\emptyWindowChatSessions\` |
| Linux / macOS | `~/.config/Code/User/globalStorage/emptyWindowChatSessions/` |

**Read**: JSON or JSONL. JSONL has two sub-formats:

- **Old**: `kind=0` lines contain full `v.requests[]`; take last per sessionId
- **New**: `kind=0` has empty `requests`; real data in `kind=2 k="requests"` lines (cumulative append); response patches in `kind=2 k=["requests",N,"response"]` lines

Full details: [session-copilot.md](session-copilot.md)

---

### Cursor

**Paths**

| OS | Path |
|---|---|
| Windows | `%USERPROFILE%\.cursor\projects\{slug}\agent-transcripts\{uuid}\{uuid}.jsonl` |
| Linux / macOS | `~/.cursor/projects/{slug}/agent-transcripts/{uuid}/{uuid}.jsonl` |

Slug: lowercase drive + single dashes (e.g. `C:\Users\user\MyProject` → `c-Users-user-MyProject`). Each `{uuid}` folder contains exactly one `{uuid}.jsonl` file.

**Find**

```powershell
# Windows
Get-ChildItem "$env:USERPROFILE\.cursor\projects" -Directory |
  Sort-Object LastWriteTime -Descending | Select-Object -First 3 |
  ForEach-Object { Get-ChildItem "$($_.FullName)\agent-transcripts\*\*.jsonl" |
    Sort-Object LastWriteTime -Descending | Select-Object -First 2 }
```

**Read**: JSONL — each line is one message: `role` ("user"/"assistant") and `message.content[].text` where `type === "text"`. Read from the end for recent turns. Full details: [session-cursor.md](session-cursor.md)

---

### OpenAI Codex CLI

**Paths**

| OS | Path |
|---|---|
| Windows | `%USERPROFILE%\.codex\sessions\rollout-*.jsonl` |
| Linux / macOS | `~/.codex/sessions/rollout-*.jsonl` |

**Read**: JSONL. Relevant types: `session_meta` (has `payload.cwd` for workspace path) and `response_item` (when `payload.type === "message"`). Content at `payload.content[].text`. Skip `developer`/`system` roles and Codex-injected prefixes (`<permissions instructions>`, `<collaboration_mode>`, etc.). Full details: [session-codex.md](session-codex.md)

---

### Kiro

Two formats — Format B (newer) takes priority:

**Format B** (has workspace path): `kiro.kiroagent\workspace-sessions\{Base64URL(path)}\{uuid}.json`  
→ `{ "workspaceDirectory": "...", "history": [{ "message": { "role": "user"|"assistant", "content": "..." | ContentPart[] } }] }`

**Format A** (legacy): `kiro.kiroagent\{hex32}\*.chat`  
→ `{ "chat": [{ "role": "user"|"bot"|"human"|"tool", "content": "..." }] }` — skip `tool` role and bot-only-ack messages ("On it.", "Understood.")

Full details: [session-kiro.md](session-kiro.md)

---

### Windsurf / Trae

- **Windsurf** (`%APPDATA%\Windsurf\User\globalStorage\chatSessions\`): binary format — fall back to path-based handoff only. See [session-windsurf.md](session-windsurf.md)
- **Trae** (`%APPDATA%\Trae\User\globalStorage\.ckg\storage\{hash}\*_codekg.db`): SQLite binary — currently unsupported. See [session-trae.md](session-trae.md)

---

### Antigravity

**Paths**

| OS | Path |
|---|---|
| Windows | `%USERPROFILE%\.gemini\antigravity\brain\{uuid}\.system_generated\logs\transcript.jsonl` (or `overview.txt`) |
| Linux / macOS | `~/.gemini/antigravity/brain/{uuid}/.system_generated/logs/transcript.jsonl` (or `overview.txt`) |

**Read**: JSONL.

- Note: Modern versions save to `transcript.jsonl` while older versions use `overview.txt`. Both use the same JSONL schema.
- User: `source === "USER"` or `"USER_EXPLICIT"` → `input`/`content`/`text`; unwrap `<USER_REQUEST>...</USER_REQUEST>` if present
- Assistant: `source === "MODEL"` + `type === "PLANNER_RESPONSE"` → `content`/`text` or `tool_calls[{name:"reply"}].args.content`
- ⚠️ Content truncated at ~900 chars; full history is cloud-only. Full details: [session-antigravity.md](session-antigravity.md)

---

## Layer 2: Reading Rules

- Read the tail / most recent messages first. Only go deeper if the recent section is insufficient.
- Use keywords to locate context faster: `error`, `TODO`, `next`, `blocker`, `failed`, `plan`, `fix`
- Do not claim you read the whole session if you only read the tail.
- Distinguish confirmed facts from inference.

---

## Layer 3: Halt / Fallback Rules

Stop and report instead of guessing when:

- The file cannot be read (permissions, binary format, remote-only).
- Multiple candidate sessions conflict and workspace/time can't resolve it.

Required message:

> I can't read that local session file from this environment. Please paste the last few user/assistant turns, or let me know which recent session to prioritize.

---

## MCP Enhancement (Optional)

If the Edo Tensei MCP server is connected in your environment, you can use these tools instead of manual file search for better results:

- `list_ide_sources` — check which IDEs have sessions available
- `scan_all_sessions` — list all sessions across IDEs, sorted newest first
- `scan_project_sessions` — filter sessions by workspace path
- `get_session` / `get_session_messages` — read a specific session
- `search_sessions` — search by keyword, time, IDE, or workspace
- `generate_handoff_prompt` — generate structured handoff (path or fullText mode, 5 languages)
- `export_session` — export session to `.edo_tensei/` as Markdown

To set up the MCP server:

1. Open VS Code Command Palette (Ctrl+Shift+P)
2. Run: **Edo Tensei: Show MCP Config**
3. Follow the setup instructions for your AI client
