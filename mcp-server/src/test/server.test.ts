import { describe, it, expect } from 'vitest';
import { EdoTenseiMCPServer } from '../server.js';

describe('EdoTenseiMCPServer - get_mcp_config', () => {
  // #66: get_mcp_config crashed when the MCP client omitted the (optional)
  // `arguments` object entirely, since the handler accessed `args.client`
  // without a null check.
  it('does not crash when called with no arguments object', async () => {
    const server = new EdoTenseiMCPServer();
    const response = await (server as any).handleToolCall('get_mcp_config', undefined);

    expect(response.isError).toBe(false);
    const body = JSON.parse(response.content[0].text);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.configs)).toBe(true);
  });

  it('still returns a single client config when `client` is provided', async () => {
    const server = new EdoTenseiMCPServer();
    const response = await (server as any).handleToolCall('get_mcp_config', { client: 'cursor' });

    expect(response.isError).toBe(false);
    const body = JSON.parse(response.content[0].text);
    expect(body.success).toBe(true);
    expect(body.config.client).toBe('cursor');
  });
});
