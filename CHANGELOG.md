# Change Log

All notable changes to the "Edo Tensei" extension will be documented in this file.

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
