# Edo Tensei – AI Session Handoff Manager

[![Visual Studio Marketplace Version](https://vsmarketplacebadges.dev/version-short/Pain-Labs.edo-tensei.svg)](https://marketplace.visualstudio.com/items?itemName=Pain-Labs.edo-tensei)
[![Open VSX Version](https://img.shields.io/open-vsx/v/Pain-Labs/edo-tensei)](https://open-vsx.org/extension/Pain-Labs/edo-tensei)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/Pain-Labs/edo-tensei)](https://open-vsx.org/extension/Pain-Labs/edo-tensei)
[![AI-Ready Context](https://img.shields.io/badge/AI--Ready-LLMS.txt-blue?style=flat-square)](https://pain-labs.github.io/Edo-Tensei/llms.txt)
<!-- [![VS Marketplace Installs](https://vsmarketplacebadges.dev/installs-short/Pain-Labs.edo-tensei.svg)](https://marketplace.visualstudio.com/items?itemName=Pain-Labs.edo-tensei) -->
<!-- [![VS Marketplace Downloads](https://vsmarketplacebadges.dev/downloads-short/Pain-Labs.edo-tensei.svg)](https://marketplace.visualstudio.com/items?itemName=Pain-Labs.edo-tensei) -->

[繁體中文](./docs/README.zh-TW.md) | [日本語](./docs/README.ja.md) | [한국어](./docs/README.ko.md) | [简体中文](./docs/README.zh-CN.md) | English

![Edo Tensei – AI Session Handoff Manager for VS Code](https://raw.githubusercontent.com/Pain-Labs/Edo-Tensei/main/docs/assets/hero_banner.png)

---

## What is Edo Tensei?

When your AI quota runs out mid-task, switching to another IDE shouldn't mean losing all your context.

**Edo Tensei** (穢土轉生, "Impure World Reincarnation") extracts local AI session histories from the IDEs installed on your machine and packages them into a ready-to-paste handoff prompt — so the next agent can pick up exactly where the last one left off.

### The Lore & The Logic

In *Naruto*, **Edo Tensei** (Impure World Reincarnation) is a forbidden jutsu that summons the souls of the deceased back to the living world, binding them to a vessel to restore their memories and abilities.

This tool is named after this concept to symbolize "context reincarnation" in AI development:

- **The Deceased**: An interrupted AI session (due to quota limits, crashes, or switching tools).
- **The Vessel**: The **Handoff Prompt** extracted and packaged by this tool.
- **The Reincarnation**: Pasting the prompt into a new IDE/agent, allowing the "dead" development context to be perfectly reborn in a new AI entity.

![Workflow](https://raw.githubusercontent.com/Pain-Labs/Edo-Tensei/main/docs/assets/workflow_guide.png)

---

> **Platform**: Windows only. macOS and Linux support is not yet available.

## Supported IDEs

| IDE / Agent | Local Storage | Notes |
| :--- | :--- | :--- |
| GitHub Copilot Chat | `%APPDATA%/Code/User/…/chatSessions/` | JSON & JSONL |
| Cursor | `~/.cursor/projects/` | JSONL |
| Claude Code CLI | `~/.claude/projects/` | JSONL |
| OpenAI Codex CLI | `~/.codex/` | JSONL |
| Kiro | `%APPDATA%/Kiro/…/kiroagent/` | JSON (`.chat`) |
| Antigravity | `~/.gemini/antigravity/brain/` | Preview log only — see Known Limitations |

---

## Key Features

- **Per-IDE On-Demand Scanning**: Expand any IDE in the sidebar to scan it independently — only that IDE performs disk I/O, so the tree loads instantly. Use the toolbar **Scan All IDEs** button (⚡) to scan everything at once.
- **Pagination**: Sessions are shown in pages of up to 300. A **Load More** button appears at the bottom of any IDE that has additional sessions, keeping the tree responsive on machines with thousands of sessions.
- **Two Handoff Modes**:
  - **Path mode** *(default)*: Outputs the session file path + a per-IDE reading guide. Token-efficient; the receiving agent reads only what it needs.
  - **Full-text mode**: Embeds the complete conversation. Works everywhere, uses more tokens.
- **One-Click Resurrect**: Copies a formatted handoff prompt to clipboard — paste it into any new AI chat to restore context instantly.
- **Export to `.edo_tensei/`**: Saves handoff prompts as Markdown files, organized by `IDE/project/timestamp`.
- **Raw File Preview**: Opens the original session file directly in VS Code for manual inspection or editing.
- **Agent Skill Installer**: Run **Edo Tensei: Install Agent Skill** to install the canonical `edo-tensei` skill. Use **Generate Skill Files Manually** only when you need agent-specific skill/rule files.
- **Model Context Protocol (MCP)**: Built-in MCP server allows AI agents (Cursor, Copilot, Claude, Kiro, Antigravity) to programmatically discover, read, and export Edo Tensei sessions. Use the "Show MCP Config" UI to easily configure your specific AI client.
- **`.gitignore` Helper**: Automatically prompts you to add `.edo_tensei/` to `.gitignore` so local exports don't pollute your repo.

![Features](https://raw.githubusercontent.com/Pain-Labs/Edo-Tensei/main/docs/assets/features.png)

---

## Quick Start

![Edo Tensei product demo](https://raw.githubusercontent.com/Pain-Labs/Edo-Tensei/main/docs/assets/edo-tensei-product-demo.gif)

1. Open the **Edo Tensei** view in the VS Code Activity Bar (cracked folder icon).
2. **Expand an IDE** in the sidebar — it scans automatically on first expand. Use the toolbar ⚡ **Scan All IDEs** button to scan all IDEs at once.
3. If an IDE has more sessions than the current page, click **Load More** at the bottom of that IDE's list.
4. **Click a session** to instantly copy the handoff prompt to your clipboard.
5. (Optional) Right-click a session for **Advanced** options like Export or Preview. Use the IDE-row **Export All** button (💾) to export every session for that IDE.
6. **Paste** the prompt into your target IDE/Agent and continue.

---

## Configuration

Open VS Code Settings and search for `edoTensei`.

| Setting | Options | Default | Description |
| :--- | :--- | :--- | :--- |
| `edoTensei.handoffMode` | `path` / `fullText` | `path` | `path` is recommended for token efficiency. |
| `edoTensei.promptLanguage` | `English` / `Traditional Chinese` / `Simplified Chinese` / `Japanese` / `Korean` | `English` | Language of the generated handoff prompt. |
| `edoTensei.customScanPaths` | Object `{ "claude": [], … }` | `{}` | Override the default scan directories for any IDE. |

### Custom Scan Paths Example

```json
{
  "edoTensei.customScanPaths": {
    "claude": ["D:/custom-claude-projects"],
    "copilot": ["E:/another-vscode-profile/chatSessions"]
  }
}
```

---

## Commands

All commands are available via the Command Palette (`Ctrl+Shift+P`) under the `Edo Tensei` category.

| Command | Description |
| :--- | :--- |
| Scan All IDEs | Scan every IDE for all local sessions (toolbar ⚡ button) |
| Refresh This IDE | Re-scan a single IDE (inline button on the IDE row) |
| Load More Sessions | Load the next page of sessions for an IDE |
| Copy Handoff Prompt | Copy handoff prompt for the selected session |
| View Parsed Session | Open a rendered Markdown preview of the session |
| Preview Raw Session File | Open the original session file |
| Copy Raw File Path | Copy the session file path to clipboard |
| Export Session to .edo_tensei | Save handoff prompt as a Markdown file |
| Export All Sessions to .edo_tensei | Save all sessions for the selected IDE to `.edo_tensei/` (inline button on the IDE row) |
| Install Agent Skill | Install the canonical `edo-tensei` skill; use **Generate Skill Files Manually** inside the command only when you need agent-specific files |
| Show MCP Config | Open UI panel to get copy-paste MCP server configuration for your AI client |

---

## Model Context Protocol (MCP) Server

Edo Tensei includes a built-in [Model Context Protocol](https://modelcontextprotocol.io/) server that allows AI agents to directly interact with your session history without leaving their chat interface.

Instead of manually exporting or copying prompts, your AI agent can automatically discover past sessions, read full conversation contexts, and resume interrupted workflows.

To set up the MCP server:

1. Run the **Edo Tensei: Show MCP Config** command.
2. Select your AI client (Cursor, GitHub Copilot, Claude Code, Kiro, or Antigravity).
3. Choose your workspace configuration preference (Recommended, Selected, Variable, or All Workspaces).
4. Copy the generated JSON snippet into your client's MCP configuration file.

For detailed documentation, see the [MCP Server README](./mcp-server/README.md).

---

## Agent Skills

Run **Edo Tensei: Install Agent Skill** and choose **Auto Install (Recommended)** to install the canonical `edo-tensei` skill. You can also run the same install command directly:

```bash
npx skills add Pain-Labs/Edo-Tensei
```

Choose **Generate Skill Files Manually** only when you need to write agent-specific skill/rule files yourself. The generated asset is designed as a structured SOP instead of a loose note: it tells the receiving agent how to locate likely session files, read only the recent relevant portion, stop when confidence is low, and return a clean handoff summary.

Supported outputs:

- Claude Code: `.claude/skills/edo-tensei/SKILL.md`
- GitHub Copilot: `.github/skills/edo-tensei/SKILL.md`
- Kiro IDE: `.kiro/skills/edo-tensei/SKILL.md`
- Antigravity: `.agents/skills/edo-tensei/SKILL.md`
- Cline: `.cline/skills/edo-tensei/SKILL.md`
- Gemini CLI: `.gemini/skills/edo-tensei/SKILL.md`
- Cursor: `.cursor/rules/edo-tensei.mdc`

Notes:

- Cursor uses a rule file, not a slash-command skill.
- The handoff prompt now includes a file-read fallback even when an `edo-tensei` skill/rule is present, so generated prompts stay usable across mixed toolchains.

---

## Privacy & Local-First

Edo Tensei is completely **local-first**. All extraction and parsing runs on your machine, reading directly from local files (SQLite, JSONL, JSON, or text). No data is sent to any external server.

The `.edo_tensei/` export folder is created inside your workspace. The extension will prompt you to add it to `.gitignore` on first use.

---

## Known Limitations

- **macOS / Linux**: Not yet supported. The extension is currently Windows-only.
- **Trae**: Not yet supported. Local databases use SQLCipher encryption; no public key is available.
- **Windsurf**: Session files are stored in a binary protobuf format. The previous path-only fallback is currently disabled, so Windsurf sessions do not appear in scan results until a reliable parser is available.
- **Antigravity**: Extracts from `overview.txt` (preview log), which truncates messages at ~900 characters. Full conversation history is stored in Antigravity's cloud only and is not accessible locally.

---

## Recommended Companions

### Quick Prompt

Capture next tasks and reusable snippets while your AI agent is running — without switching windows.

[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=winterdrive.quick-prompt) | [Open VSX Registry](https://open-vsx.org/extension/winterdrive/quick-prompt)

### VirtualTabs

Organize files by task across any directory, persisted across sessions.

[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=winterdrive.virtual-tabs) | [Open VSX Registry](https://open-vsx.org/extension/winterdrive/virtual-tabs)

---

## Bug Reports

Found a bug? Please [open an issue](https://github.com/Pain-Labs/Edo-Tensei/issues) and include:

- OS version (e.g., Windows 11 22H2)
- Source IDE and the session you were trying to extract
- Steps to reproduce

---

## Contributing

Contributions are welcome! Feel free to open a [pull request](https://github.com/Pain-Labs/Edo-Tensei/pulls) or start a discussion in [Issues](https://github.com/Pain-Labs/Edo-Tensei/issues).

Areas that would benefit from help:

- **New IDE extractors** — especially macOS / Linux path support
- **Windsurf / Trae** — if you have insights into their session formats
- **Translations** — improving or adding localized READMEs

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for release history.

---

## License

[MIT](./LICENSE)
