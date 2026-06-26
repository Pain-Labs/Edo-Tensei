# Change Log

All notable changes to the "Edo Tensei" extension will be documented in this file.

## [1.6.2] - Antigravity Multi-Path & JSONL Support - 2026-06-23

### 🚀 Feature

- **Antigravity Multi-Path Detection**: Automatically scans multiple `.gemini/antigravity*` data directories under home directory (such as `antigravity-ide` or backup profiles) dynamically.
- **Antigravity JSONL Support**: Added support for new `transcript.jsonl` preview format alongside legacy `overview.txt` logs.

## [1.6.1] - Multi-Workspace Skill Selection - 2026-06-18

### 🐛 Bug Fix

- **Agent Skill workspace picker** (closes #44): when multiple workspace folders are open, a QuickPick now lets the user choose which project to generate the skill into, instead of always defaulting to the first one
- `.gitignore` rule insertion now anchors to the selected project root instead of the resolved export workspace folder

## [1.5.0] - Session Search & Save Fix - 2026-06-03

### 🔍 Session Keyword Search (closes #34)

- Added **Search Sessions** button (`$(search)`) to the sidebar toolbar
- Opens a QuickPick that filters sessions live by title, workspace path, or IDE as you type
- Powered by the existing `SessionSearchEngine`; searches title + workspace by default (message-content search available via MCP)
- Shows up to 30 results ranked by relevance; selecting a result opens the parsed session view

### 🐛 Bug Fix

- **Untitled document EPERM on save**: `viewParsedSession` now anchors the untitled preview document to the workspace folder path, so the save dialog defaults to a writable location instead of triggering an EPERM error when VS Code attempted to write to a system path

### 📄 Documentation

- Added `npx skills add Pain-Labs/Edo-Tensei` install instruction to README Agent Skills section

## [1.3.0] - Agent Skill & Session Docs - 2026-05-24

### 🧠 Agent Skill (npx skills add)

- Added `skills/edo-tensei/SKILL.md` as SSOT for `npx skills add Pain-Labs/Edo-Tensei`
- Skill-first architecture: works in any environment with file system access — no VS Code or MCP required
- MCP tools listed as optional enhancement at the bottom of the skill

### 📄 Session Documentation

- Migrated `docs/skills/session-*.md` → `skills/edo-tensei/session-*.md` (downloadable via npx alongside SKILL.md)
- Added `session-trae.md` documenting SQLite-based Trae storage (currently unsupported, fallback message provided)
- Corrected Cursor path: `workspaceStorage/{hash}/agent-transcripts/` → `~/.cursor/projects/{slug}/agent-transcripts/`
- Corrected Codex type names: `session_meta` + `response_item` (previously documented incorrectly as `message`/`user_message`)
- Documented Kiro Format B (`workspace-sessions/{Base64URL(path)}/{uuid}.json` with `workspaceDirectory` field)
- Documented Copilot new JSONL format (kind=0 empty header + kind=2 cumulative append mode for requests and responses)
- Documented Antigravity `USER_EXPLICIT` source type and `<USER_REQUEST>` tag extraction

### 🔧 Internal

- Refactored `SkillGenerator.ts`: replaced 276-line hardcoded template with a direct read of `skills/edo-tensei/SKILL.md`; button-generated skill is now always in sync with the canonical SKILL.md and copies all `session-*.md` files alongside it

## [1.2.0] - Per-IDE Scanning, Pagination & UX Polish - 2026-05-20

### ⚡ Per-IDE On-Demand Scanning & Pagination

- **Per-IDE on-demand scanning**: Each IDE in the sidebar is now scanned independently when you first expand it, instead of triggering a global scan-all. The tree loads instantly and only the IDE you care about performs disk I/O.
- **Pagination**: Sessions are displayed in pages of up to 300. A "Load More" button appears at the bottom of any IDE that has additional sessions, preventing the tree from becoming unresponsive on machines with thousands of sessions.
- **IO concurrency throttle**: Extractor scan concurrency is capped at 2 simultaneous IDE scans, preventing file system saturation on machines with slow or network-backed storage.

### 🎨 Tooltip & Handoff Prompt Improvements

- **Richer session tooltips**: Hovering over a session now shows a formatted Markdown tooltip including the workspace path, project name, IDE, timestamp, message count, and estimated token count. Counts are updated precisely when messages are lazily loaded on hover.
- **Workspace path in transcript header**: The readable transcript generated for handoff prompts now includes the workspace path on the second line, giving the receiving AI clearer context about which project the session belongs to.

### 🔧 UX Adjustments

- **Export All Sessions per IDE**: The "Export All Sessions" button has moved from the panel toolbar to each IDE item's inline action row, so you export only the sessions for that specific IDE instead of all IDEs at once.

### 🐛 Bug Fixes

- **Antigravity session titles**: Sessions whose user messages were wrapped in `<USER_REQUEST>` XML tags (all sessions since Antigravity's 2026-04-22 format change) now display clean titles instead of showing the raw tag text.

### 🧪 Test Infrastructure

- Added `vscode-extension-tester` E2E test infrastructure (`npm run test:ui`) with a sidebar smoke test that verifies the activity bar button, section name, and all expected IDE tree items.
- Added unit tests for `ClaudeExtractor` (JSONL parsing, cwd extraction, slug resolution), `CursorExtractor` (path-to-slug), and `KiroExtractor` (both legacy `.chat` and new `workspace-sessions` JSON formats, Base64URL path decoding).
- Added regression tests for `SessionHandoffService.buildReadableTranscript` and `SessionHandoffProvider` tooltip/tree behaviour.
- Added `packageJson` config tests to guard toolbar and inline button placement against accidental changes.
- Added `test:unit` and `test:ui` scripts to `package.json` for targeted test runs.

## [1.1.2] - Codex Sanitization & Test Coverage - 2026-05-16

### Security

- Hardened Codex session parsing so injected scaffolding such as `<environment_context>`, `<permissions instructions>`, `<collaboration_mode>`, `<skills_instructions>`, and AGENTS.md instruction blocks are filtered without using broad multi-character tag-stripping sanitizers.
- Preserved real user prompts when Codex-injected scaffolding is followed by actual user content, preventing over-filtering during session handoff.
- Kept angle-bracket title sanitization from reconstructing malformed tag payloads.

### Tests and CI

- Added focused Vitest coverage for Codex injected-message filtering, rollout parsing, workspace filtering, fallback extraction behavior, and filesystem discovery edge cases.
- Added core unit tests for `PathInference`, `SessionSearchEngine`, and `TimeFilter`.
- Added `npm run test:coverage` using `@vitest/coverage-v8` and configured coverage thresholds for the tested core files.
- Updated PR validation to run tests with coverage before packaging the extension.

## [1.0.6] - Bug Fix & Performance - 2026-05-09

### Copilot Chat — Critical Bug Fixes

- **Session not found fix**: Resolved a parsing bug where Copilot JSONL sessions in the new incremental-patch format were silently skipped. The root cause was the `["requests"]` key being stored as a JSON array instead of a plain string — the extractor only matched the string form, so all new-format sessions went undetected in both project scan and scan-all.
- **JSONC workspace fix**: Fixed a crash when resolving `.code-workspace` files that contain `//` line comments (standard VS Code JSONC). `JSON.parse` would throw; extractor now strips comments before parsing, so multi-root workspaces are correctly resolved.
- **Incomplete message export fix**: Fixed message content being truncated or missing. New-format JSONL uses append-mode — each `["requests"]` block adds exactly one request; extractor was incorrectly treating each block as a full replacement. Now correctly accumulates all blocks and applies response patches to reconstruct the full conversation.
- **Wrong project attribution fix**: In multi-root workspaces, sessions were being attributed to the wrong project (last folder wins). Changed merge strategy to first-wins so each session appears under the correct root.

### Performance

- **Break-early prescan**: For new-format JSONL sessions, prescan now stops reading as soon as the session ID and first user message are found (typically within the first 5 lines), avoiding unnecessary I/O on large session files (some exceed 100 MB).
- **Bounded scan concurrency**: `extractAll` now processes workspace storage entries in batches of 8 instead of all at once, reducing peak concurrent file operations from ~1600 to ~160.

### Tests

- Added 12 unit tests for `CopilotExtractor` covering all three JSONL format generations, prescan, full-load, scan-all, and project-scoped filtering (including multi-root `.code-workspace` resolution).

## [1.0.4] - Feature - 2026-05-08

- **Model Context Protocol (MCP) Server (Beta)**: Introduced a built-in MCP server that enables AI agents (Cursor, Copilot, Claude, Kiro, Antigravity) to programmatically discover, read, and export Edo Tensei sessions.
- **MCP Config Panel (Beta)**: Added a new "Edo Tensei: Show MCP Config" command and UI panel to provide one-click configuration snippets tailored for specific AI clients and workspace settings.
- **Core Search Engine Upgrade**: Refactored session scanning logic into a standalone `SessionSearchEngine` with advanced `TimeFilter` and `PathInference` capabilities to support robust MCP queries.
- **Extractor Enhancements**: Improved parsing logic for `Antigravity` and `Kiro` to handle edge cases and log anomalies more effectively.
- **i18n Translations**: Updated localizations across five languages to cover the new MCP interface and commands.

## [1.0.3] - Enhancement - 2026-05-04

- **Multi-Root Workspace Support**: `Scan Sessions (Project)` now scans and merges sessions across all workspace folders (not just the first root).
- **Copilot Multi-Root Fix**: Improved Copilot `workspaceStorage` matching for multi-root workspaces by resolving `.code-workspace` folder entries and using them for early filtering.
- **Kiro Legacy Session Deduplication**: Deduplicated legacy Kiro `*.chat` sessions by `executionId` to prevent graph fragments from appearing as separate sessions.
- **Scan UX Improvements**: Tree view now shows per-IDE scan status and found counts (e.g. `scanning/done/error • N`) during scans, and final results are sorted newest-first.

## [1.0.1] - Enhancement - 2026-05-02

- **Agent Skill Generator**: Added `Generate Agent Skill` to emit `edo-tensei` skill/rule files for Claude Code, GitHub Copilot, Kiro, Antigravity, Cline, Gemini CLI, and Cursor.
- **Skill SOP Upgrade**: Reworked the generated `edo-tensei` skill/rule content into a clearer SOP with search order, selective-reading rules, and halt/fallback guidance.
- **Documentation**: Added README coverage for generated agent skills so the feature is visible in the product docs.
- **Skill-Aware Handoff Prompts**: When an `edo-tensei` skill/rule is present, path-mode handoff prompts now include both the skill invocation shortcut and a manual file-read fallback.
- **Kiro Session Cleanup**: Improved legacy Kiro `.chat` parsing and title extraction so system wrappers, rule injections, and boilerplate are less likely to pollute visible session titles.
- **Bug Fixes**: Fixed various edge cases in session parsing and title generation across supported IDEs.
- **Maintenance**: Updated `.vscodeignore` to exclude redundant documentation, design drafts, and internal scripts from the production package.

## [1.0.0] - Initial Release - 2026-04-30

- **Core Extraction**: Extracted the Edo Tensei (Session Handoff) system into a standalone VS Code extension.
- **Multi-IDE Support**: Added extraction support for Claude Code CLI, Windsurf, Cursor, Copilot Chat, Kiro, and Antigravity.
- **Intelligent Title Generation**: Automatically parses chat logs to extract meaningful user intent rather than noise/XML tags.
- **Hierarchical View**: Organizes history by `IDE` → `Project` → `Session` for better context management.
- **Resurrect Session**: One-click resurrection formatting to seamlessly pass context to a new AI agent session.
