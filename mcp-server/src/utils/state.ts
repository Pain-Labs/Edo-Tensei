/** Persisted MCP server state (~/.edo-tensei-mcp-state.json). */
export interface McpState {
  lastWorkspaceRoot?: string;
}

/**
 * Parse the raw state file contents defensively. Valid JSON that is not an
 * object (e.g. `null`, `[]`, `42`) or a non-string `lastWorkspaceRoot` must not
 * crash server startup, so anything unexpected degrades to an empty state.
 */
export function parseState(raw: string): McpState {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  const root = (parsed as Record<string, unknown>).lastWorkspaceRoot;
  return typeof root === 'string' && root ? { lastWorkspaceRoot: root } : {};
}
