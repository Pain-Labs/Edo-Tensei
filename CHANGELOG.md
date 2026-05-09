# Change Log

All notable changes to the "Edo Tensei" extension will be documented in this file.

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
