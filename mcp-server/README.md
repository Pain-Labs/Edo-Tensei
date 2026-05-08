# Edo Tensei MCP Server

The Model Context Protocol (MCP) server for Edo Tensei, enabling AI agents (Cursor, GitHub Copilot, Claude, Kiro, Antigravity) to discover and manage AI session handoffs programmatically.

## Features

The MCP Server exposes 8 tools covering:

- **Session Discovery**: Scan sessions from all supported IDEs or specific projects
- **Session Access**: Retrieve session metadata and full conversation content
- **Handoff Operations**: Generate handoff prompts (path/fullText modes) and export sessions
- **Configuration**: Get client-specific MCP configuration instructions

## Architecture: Tool / Resource / Prompt

| Primitive | Purpose | Example |
|:---|:---|:---|
| **Tool** | 🦴 Hand — performs actions | `scan_all_sessions`, `generate_handoff_prompt` |
| **Resource** | 📖 Reference — supplies context | `edotensei://docs/complete` |
| **Prompt** | 🧠 SOP template — encodes workflow | `edo-tensei:handoff-current` |

## Installation

```bash
cd mcp-server
npm install
```

## Build

```bash
npm run build
```

Or from the root directory:

```bash
npm run build:mcp
```

## Start

```bash
npm start -- --workspace-root /path/to/your/workspace
```

## Development

```bash
# Watch mode (auto-recompile)
npm run watch
```

## Configuring MCP Clients

Use the VS Code command **"Edo Tensei: Show MCP Config"** to view detailed, per-client configuration instructions.

Supported clients:
- **Cursor** — AI-powered code editor
- **GitHub Copilot** — VS Code AI assistant
- **Claude Code** — Anthropic's desktop app
- **Kiro** — Professional AI IDE
- **Antigravity** — Google's AI IDE

## Available Tools

### Session Discovery

| Tool | Description |
|:---|:---|
| `scan_all_sessions` | Scan all supported IDEs and return all accessible sessions |
| `scan_project_sessions` | Scan sessions related to a specific workspace path |
| `list_ide_sources` | List all supported IDE sources and their availability |

### Session Access

| Tool | Description |
|:---|:---|
| `get_session` | Get detailed information about a specific session |
| `get_session_messages` | Get full conversation messages for a session |

### Handoff Operations

| Tool | Description |
|:---|:---|
| `generate_handoff_prompt` | Generate handoff prompt (path or fullText mode) |
| `export_session` | Export session to `.edo_tensei/` directory |

### Configuration

| Tool | Description |
|:---|:---|
| `get_mcp_config` | Get MCP client configuration for various AI clients |

## Session ID Format

Sessions are identified using a composite ID: `${ide}:${sessionId}`

Examples:
- `cursor:abc123-def456`
- `copilot:session_12345`
- `claude:my-project-session`

## License

MIT
