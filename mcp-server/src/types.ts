/**
 * Common types for Edo Tensei MCP Server
 */

export enum ErrorType {
  NOT_FOUND = 'NOT_FOUND',
  INVALID_PARAMS = 'INVALID_PARAMS',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  PARSE_ERROR = 'PARSE_ERROR',
}

export interface ToolResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    type: ErrorType;
    message: string;
  };
  message?: string;
}

export interface SessionSummary {
  id: string;
  ide: string;
  title?: string;
  workspacePath?: string;
  capturedAt: string;
  messageCount: number;
  fileSizeBytes: number;
  rawPath?: string;
  status: 'success' | 'empty' | 'encrypted' | 'not_found' | 'unknown_format' | 'error';
}

export interface IdeSourceInfo {
  ide: string;
  displayName: string;
  isAvailable: boolean;
  scanPath: string[];
  sessionCount: number;
}

export interface HandoffPromptResult {
  prompt: string;
  mode: 'path' | 'fullText';
  language: string;
  estimatedTokens: number;
}

export interface ExportResult {
  success: boolean;
  exportPath: string;
  fileName: string;
}

export interface McpConfigInfo {
  client: string;
  configPath: string;
  command: string;
  args: string[];
  json: object;
}
