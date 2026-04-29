# Edo Tensei – AI Session Handoff Manager

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/Pain-Labs.edo-tensei)](https://marketplace.visualstudio.com/items?itemName=Pain-Labs.edo-tensei)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/Pain-Labs.edo-tensei)](https://marketplace.visualstudio.com/items?itemName=Pain-Labs.edo-tensei)
[![AI-Ready Context](https://img.shields.io/badge/AI--Ready-LLMS.txt-blue?style=flat-square)](https://pain-labs.github.io/Edo-Tensei/llms.txt)

[繁體中文](./docs/README.zh-TW.md) | [日本語](./docs/README.ja.md) | [한국어](./docs/README.ko.md) | [简体中文](./docs/README.zh-CN.md) | English

![Edo Tensei – AI Session Handoff Manager for VS Code](docs/assets/hero_banner.png)

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

![Workflow](./docs/assets/workflow_guide.png)

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
| Windsurf | `~/.codeium/windsurf/cascade/` | Binary (path-only handoff) |
| Antigravity | `~/.gemini/antigravity/brain/` | Preview log only — see Known Limitations |

---

## Key Features

- **Multi-IDE Extraction**: Automatically scans all supported IDEs and surfaces sessions grouped by `IDE → Project → Session`.
- **Project-Scoped Scan**: "Scan Project Sessions" filters to only sessions that match your current workspace.
- **Two Handoff Modes**:
  - **Path mode** *(default)*: Outputs the session file path + a per-IDE reading guide. Token-efficient; the receiving agent reads only what it needs.
  - **Full-text mode**: Embeds the complete conversation. Works everywhere, uses more tokens.
- **One-Click Resurrect**: Copies a formatted handoff prompt to clipboard — paste it into any new AI chat to restore context instantly.
- **Export to `.edo_tensei/`**: Saves handoff prompts as Markdown files, organized by `IDE/project/timestamp`.
- **Raw File Preview**: Opens the original session file directly in VS Code for manual inspection or editing.
- **`.gitignore` Helper**: Automatically prompts you to add `.edo_tensei/` to `.gitignore` so local exports don't pollute your repo.

![Features](./docs/assets/features.png)

---

## Quick Start

1. Open the **Edo Tensei** view in the VS Code Activity Bar (archive icon).
2. Click **Scan Project Sessions** to find sessions matching your current workspace, or **Fetch ALL Historical Sessions** to scan everything.
3. Browse sessions grouped by IDE in the tree view.
4. Right-click a session and choose **Copy Handoff Prompt** to copy a ready-to-paste prompt.
5. Paste into your new IDE / AI agent and continue.

![UI Overview](./docs/assets/ui_sidebar_overview.png)

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
| Scan Project Sessions | Find sessions matching the current workspace |
| Fetch ALL Historical Sessions | Scan every IDE for all local sessions |
| Copy Handoff Prompt | Copy handoff prompt for the selected session |
| View Parsed Session | Open a rendered Markdown preview of the session |
| Preview Raw Session File | Open the original session file |
| Copy Raw File Path | Copy the session file path to clipboard |
| Export Session to .edo_tensei | Save handoff prompt as a Markdown file |
| Export All Sessions to .edo_tensei | Save all scanned sessions to `.edo_tensei/` |

---

## Privacy & Local-First

Edo Tensei is completely **local-first**. All extraction and parsing runs on your machine, reading directly from local files (SQLite, JSONL, JSON, or text). No data is sent to any external server.

The `.edo_tensei/` export folder is created inside your workspace. The extension will prompt you to add it to `.gitignore` on first use.

---

## Known Limitations

- **macOS / Linux**: Not yet supported. The extension is currently Windows-only.
- **Trae**: Not yet supported. Local databases use SQLCipher encryption; no public key is available.
- **Windsurf**: Session files are stored in a binary protobuf format. Edo Tensei falls back to **path mode only** — it copies the file path and a reading guide, but cannot embed the full conversation.
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

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for release history.

---

## License

[MIT](./LICENSE)
