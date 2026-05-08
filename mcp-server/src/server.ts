/**
 * Edo Tensei MCP Server Implementation
 *
 * This file is responsible for:
 * - Initializing the low-level MCP Server (supports Logging / Prompts / Resources / Tools Capabilities)
 * - Registering all tools, prompt templates, and documentation resources
 * - Handling tool call requests and routing them to the corresponding Tools class
 * - Supporting the MCP Roots protocol for dynamically obtaining the workspace path
 * - Structured MCP Logging (log level can be dynamically set by the client)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  LoggingLevel,
  ReadResourceRequestSchema,
  RootsListChangedNotificationSchema,
  SetLevelRequestSchema,
  type Root,
} from '@modelcontextprotocol/sdk/types.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { z } from 'zod';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { SessionTools } from './tools/sessionTools.js';
import { HandoffTools } from './tools/handoffTools.js';
import { Logger } from './utils/Logger.js';

const SERVER_NAME = 'edo-tensei';
const SERVER_VERSION = '1.0.0';

// ── Logging ────────────────────────────────────────────────────────────────────

const LOG_LEVEL_ORDER: LoggingLevel[] = [
  'debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency',
];

// ── Tool definitions (schemas) ─────────────────────────────────────────────────────

const TOOL_DEFS = {
  scan_all_sessions: {
    description: 'Scan all supported IDEs and return a summary of all accessible sessions.',
    schema: {},
  },
  scan_project_sessions: {
    description: 'Scan for sessions related to a specific workspace/project path.',
    schema: {
      workspacePath: z.string().describe('Absolute path to the workspace/project directory to scan for.'),
    },
  },
  list_ide_sources: {
    description: 'List all supported IDE sources and their scan status.',
    schema: {},
  },
  get_session: {
    description: 'Get detailed information about a specific session (without full messages).',
    schema: {
      sessionId: z.string().describe('Session ID in format "ide:sessionId" (e.g., "cursor:abc123").'),
    },
  },
  get_session_messages: {
    description: 'Get the full conversation messages for a specific session.',
    schema: {
      sessionId: z.string().describe('Session ID in format "ide:sessionId".'),
      maxMessages: z.number().optional().describe('Maximum number of messages to return (optional).'),
    },
  },
  search_sessions: {
    description: 'Search sessions using keyword/regex plus time filters. Current MCP scanner searches session metadata and paths; full message search will be available after extractor integration.',
    schema: {
      query: z.string().optional().describe('Space-separated keyword terms. All terms must match.'),
      regex: z.string().optional().describe('Regular expression to match against session metadata.'),
      time: z.string().optional().describe('Time filter, e.g. "today", "yesterday", "this week", "recent 3 days", "2026/05/01 - 2026/05/07".'),
      ide: z.string().optional().describe('Optional IDE id filter, e.g. cursor, claude, kiro, antigravity.'),
      workspacePath: z.string().optional().describe('Optional workspace path filter.'),
      limit: z.number().optional().describe('Maximum number of results. Default: 30.'),
    },
  },
  generate_handoff_prompt: {
    description: 'Generate a handoff prompt for a session. Supports "path" mode (file reference) and "fullText" mode (embedded conversation).',
    schema: {
      sessionId: z.string().describe('Session ID in format "ide:sessionId".'),
      mode: z.enum(['path', 'fullText']).describe('Handoff mode: "path" for file reference, "fullText" for embedded conversation.'),
      language: z.enum(['English', 'Traditional Chinese', 'Simplified Chinese', 'Japanese', 'Korean']).optional().describe('Language for the prompt (default: English).'),
      filePath: z.string().optional().describe('Required for path mode: the session file path.'),
      ide: z.string().optional().describe('IDE identifier (auto-detected from sessionId if not provided).'),
      messages: z.array(z.object({
        role: z.string(),
        content: z.string(),
        thought: z.string().optional(),
      })).optional().describe('Required for fullText mode: the conversation messages.'),
    },
  },
  export_session: {
    description: 'Export a session to the .edo_tensei/ directory in the workspace.',
    schema: {
      sessionId: z.string().describe('Session ID in format "ide:sessionId".'),
      targetWorkspace: z.string().optional().describe('Target workspace path (defaults to configured workspace root).'),
      sessionData: z.object({
        ide: z.string(),
        title: z.string().optional(),
        workspacePath: z.string().optional(),
        capturedAt: z.string(),
        messages: z.array(z.object({
          role: z.string(),
          content: z.string(),
          thought: z.string().optional(),
          timestamp: z.string().optional(),
        })),
      }).optional().describe('Session data for export (if not already cached).'),
    },
  },
  get_mcp_config: {
    description: 'Get MCP client configuration instructions for various AI clients (Cursor, Copilot, Claude, etc.).',
    schema: {
      client: z.enum(['cursor', 'copilot', 'claude', 'kiro', 'windsurf', 'antigravity']).optional().describe('Specific client to get config for (optional).'),
    },
  },
};

// ── Prompt definitions ─────────────────────────────────────────────────────────

const PROMPT_DEFS = {
  'edo-tensei:handoff-current': {
    description: 'Generate a handoff prompt for the current/most recent session.',
    args: {
      targetIde: z.string().optional().describe('Target IDE that will receive the handoff (affects prompt format).'),
    },
  },
  'edo-tensei:export-project': {
    description: 'Export all sessions for a specific project to .edo_tensei/ directory.',
    args: {
      workspacePath: z.string().describe('Absolute path to the project workspace.'),
    },
  },
};

// ── Resource definitions ───────────────────────────────────────────────────────

const RESOURCE_DEFS = {
  'edotensei://docs/complete': {
    name: 'Edo Tensei Complete Documentation',
    description: 'Complete reference for Edo Tensei MCP server including tool schemas, session ID format, handoff prompt structure, and workflow examples.',
    mimeType: 'text/markdown',
  },
};

// ── Server Class ─────────────────────────────────────────────────────────────

export class EdoTenseiMCPServer {
  private server: Server;
  private sessionTools: SessionTools;
  private handoffTools: HandoffTools;
  private workspaceRoot: string | undefined;
  private currentLogLevel: LoggingLevel = 'info';

  constructor(initialWorkspaceRoot?: string) {
    this.workspaceRoot = initialWorkspaceRoot;
    this.sessionTools = new SessionTools(initialWorkspaceRoot);
    this.handoffTools = new HandoffTools(initialWorkspaceRoot);

    this.server = new Server(
      { name: SERVER_NAME, version: SERVER_VERSION },
      {
        capabilities: {
          logging: {},
          prompts: {},
          resources: {},
          tools: {},
          roots: { listChanged: true },
        },
      }
    );

    this.setupHandlers();
  }

  getWorkspaceRoot(): string | undefined {
    return this.workspaceRoot;
  }

  async connect(transport: Transport): Promise<void> {
    await this.server.connect(transport);
  }

  // ── Setup Handlers ───────────────────────────────────────────────────────────

  private setupHandlers(): void {
    // Logging
    this.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
      const { level } = request.params;
      if (LOG_LEVEL_ORDER.includes(level)) {
        this.currentLogLevel = level;
        Logger.setLevel(level);
        Logger.info(`[MCP] Log level set to ${level}`);
      }
      return {};
    });

    // Tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: Object.entries(TOOL_DEFS).map(([name, def]) => ({
        name,
        description: def.description,
        inputSchema: zodToJsonSchema(def.schema || {}),
      })),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) =>
      this.handleToolCall(request.params.name, request.params.arguments)
    );

    // Prompts
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: Object.entries(PROMPT_DEFS).map(([name, def]) => ({
        name,
        description: def.description,
        arguments: Object.entries(def.args).map(([argName, argDef]) => ({
          name: argName,
          description: (argDef as any).description || '',
          required: !(argDef as any).isOptional && !(argDef as any).optional?.(),
        })),
      })),
    }));

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) =>
      this.handleGetPrompt(request.params.name, request.params.arguments)
    );

    // Resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: Object.entries(RESOURCE_DEFS).map(([uri, def]) => ({
        uri,
        name: def.name,
        description: def.description,
        mimeType: def.mimeType,
      })),
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) =>
      this.handleReadResource(request.params.uri)
    );

    // Roots (for workspace path discovery)
    this.server.setRequestHandler(RootsListChangedNotificationSchema, async () => {
      Logger.info('[MCP] Roots list changed notification received');
      return {};
    });
  }

  // ── Tool Handlers ────────────────────────────────────────────────────────────

  private async handleToolCall(name: string, args: any): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    Logger.info(`[Tool] ${name}`, args);

    try {
      let result: any;

      switch (name) {
        case 'scan_all_sessions':
          result = await this.sessionTools.scanAllSessions();
          break;

        case 'scan_project_sessions':
          result = await this.sessionTools.scanProjectSessions(args);
          break;

        case 'list_ide_sources':
          result = await this.sessionTools.listIdeSources();
          break;

        case 'get_session':
          result = await this.sessionTools.getSession(args);
          break;

        case 'get_session_messages':
          result = await this.sessionTools.getSessionMessages(args);
          break;

        case 'search_sessions':
          result = await this.sessionTools.searchSessions(args);
          break;

        case 'generate_handoff_prompt':
          result = await this.handoffTools.generateHandoffPrompt(args);
          break;

        case 'export_session':
          result = await this.handoffTools.exportSession(args);
          break;

        case 'get_mcp_config':
          result = this.generateMcpConfig(args.client);
          break;

        default:
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
            isError: true,
          };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    } catch (error) {
      Logger.error(`[Tool] ${name} failed`, error);
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }],
        isError: true,
      };
    }
  }

  // ── Prompt Handlers ──────────────────────────────────────────────────────────

  private async handleGetPrompt(name: string, args?: any): Promise<any> {
    Logger.info(`[Prompt] ${name}`, args);

    switch (name) {
      case 'edo-tensei:handoff-current': {
        const targetIde = args?.targetIde || 'unknown';
        return {
          description: `Generate handoff prompt for current session (target: ${targetIde})`,
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Please scan for the most recent session and generate a handoff prompt for transferring to ${targetIde}. Use the scan_all_sessions tool first, then generate_handoff_prompt for the most recent session.`,
              },
            },
          ],
        };
      }

      case 'edo-tensei:export-project': {
        const workspacePath = args?.workspacePath || this.workspaceRoot;
        return {
          description: `Export all sessions for project: ${workspacePath}`,
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Please scan for all sessions related to workspace "${workspacePath}" and export them to the .edo_tensei/ directory. Use scan_project_sessions followed by export_session for each session.`,
              },
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown prompt: ${name}`);
    }
  }

  // ── Resource Handlers ────────────────────────────────────────────────────────

  private async handleReadResource(uri: string): Promise<any> {
    Logger.info(`[Resource] ${uri}`);

    switch (uri) {
      case 'edotensei://docs/complete': {
        const docs = this.generateCompleteDocs();
        return {
          contents: [{
            uri,
            mimeType: 'text/markdown',
            text: docs,
          }],
        };
      }

      default:
        throw new Error(`Unknown resource: ${uri}`);
    }
  }

  // ── Helper Methods ──────────────────────────────────────────────────────────

  private generateMcpConfig(client?: string): any {
    const configs: Record<string, any> = {
      cursor: {
        success: true,
        config: {
          client: 'cursor',
          configPath: path.join(os.homedir(), '.cursor', 'mcp.json'),
          command: 'node',
          args: ['${extensionPath}/dist/mcp/index.js', '--workspace-root', '${workspaceRoot}'],
          json: {
            mcpServers: {
              'edo-tensei': {
                command: 'node',
                args: ['/path/to/edo-tensei/dist/mcp/index.js'],
                env: {},
              },
            },
          },
        },
      },
      copilot: {
        success: true,
        config: {
          client: 'copilot',
          configPath: 'VS Code Settings (User Settings JSON)',
          command: 'node',
          args: ['${extensionPath}/dist/mcp/index.js'],
          json: {
            'mcp.servers': {
              'edo-tensei': {
                command: 'node',
                args: ['/path/to/edo-tensei/dist/mcp/index.js'],
                type: 'stdio',
              },
            },
          },
        },
      },
      claude: {
        success: true,
        config: {
          client: 'claude',
          configPath: path.join(os.homedir(), '.claude', 'mcp.json'),
          command: 'node',
          args: ['${extensionPath}/dist/mcp/index.js'],
          json: {
            mcpServers: {
              'edo-tensei': {
                command: 'node',
                args: ['/path/to/edo-tensei/dist/mcp/index.js'],
              },
            },
          },
        },
      },
    };

    if (client && configs[client]) {
      return configs[client];
    }

    return {
      success: true,
      configs: Object.values(configs).map((c: any) => c.config),
    };
  }

  private generateCompleteDocs(): string {
    return `# Edo Tensei MCP Server - Complete Documentation

## Overview

Edo Tensei MCP Server enables AI agents to discover, read, and export AI chat sessions from various IDEs including Cursor, GitHub Copilot, Claude Code, Kiro, and more.

## Session ID Format

Sessions are identified using a composite ID: \`\${ide}:\${sessionId}\`

Examples:
- \`cursor:abc123-def456\`
- \`copilot:session_12345\`
- \`claude:my-project-session\`

## Tools Reference

### Session Discovery

**scan_all_sessions**
- Returns all sessions from all supported IDEs
- Sorted by capture time (newest first)

**scan_project_sessions**
- Filters sessions by workspace/project path
- Useful for finding context relevant to current project

**list_ide_sources**
- Lists all supported IDEs and their availability
- Shows scan paths and session counts per IDE

### Session Access

**get_session**
- Returns session metadata (no messages)
- Use for checking if a session exists

**get_session_messages**
- Returns full conversation history
- Optional \`maxMessages\` parameter for limiting results

### Handoff Operations

**generate_handoff_prompt**
- Mode \`path\`: Returns prompt with file path reference (token-efficient)
- Mode \`fullText\`: Returns prompt with embedded conversation
- Supports multiple languages

**export_session**
- Saves session to \`.edo_tensei/\` directory
- Creates Markdown file with formatted transcript

## Workflow Examples

### Basic Handoff

1. \`scan_all_sessions\` → Find recent sessions
2. \`get_session\` → Verify session details
3. \`generate_handoff_prompt\` → Create handoff prompt

### Project Context Export

1. \`scan_project_sessions\` with \`workspacePath\`
2. For each session: \`export_session\`

## Safety Notes

- Windsurf and Trae sessions are encrypted and cannot be read externally
- For these IDEs, only \`fullText\` mode is supported (requires messages to be provided)
- Large sessions (>15k tokens) will include a warning in generated prompts
`;
  }
}

// ── zodToJsonSchema helper ───────────────────────────────────────────────────

function zodToJsonSchema(schema: any): any {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const zodType = value as z.ZodTypeAny;
      properties[key] = zodTypeToJsonSchema(zodType);

      // Check if required
      if (!(zodType instanceof z.ZodOptional) && !(zodType instanceof z.ZodDefault)) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  return { type: 'object' };
}

function zodTypeToJsonSchema(type: z.ZodTypeAny): any {
  if (type instanceof z.ZodString) {
    return { type: 'string' };
  }
  if (type instanceof z.ZodNumber) {
    return { type: 'number' };
  }
  if (type instanceof z.ZodBoolean) {
    return { type: 'boolean' };
  }
  if (type instanceof z.ZodArray) {
    return {
      type: 'array',
      items: zodTypeToJsonSchema(type.element),
    };
  }
  if (type instanceof z.ZodObject) {
    return zodToJsonSchema(type);
  }
  if (type instanceof z.ZodOptional) {
    return zodTypeToJsonSchema(type.unwrap());
  }
  if (type instanceof z.ZodEnum) {
    return {
      type: 'string',
      enum: type.options,
    };
  }

  return { type: 'string' };
}
