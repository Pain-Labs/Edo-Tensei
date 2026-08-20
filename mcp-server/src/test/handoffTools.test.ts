import { describe, it, expect } from 'vitest';
import { HandoffTools } from '../tools/handoffTools.js';

describe('HandoffTools.generateHandoffPrompt - $-pattern safety', () => {
  // String.prototype.replace() treats `$$`, `$&`, `$\`` and `$'` specially in
  // the *replacement* argument even when the search term is a plain string.
  // filePath/message content are untrusted (e.g. Windows admin-share paths
  // like `\\server\c$\Users\...`), so a literal `$` could silently corrupt
  // or garble the generated prompt if replace() were called directly.
  it('preserves a literal "$" in filePath without corruption', async () => {
    const tools = new HandoffTools();
    const result = await tools.generateHandoffPrompt({
      sessionId: 'claude:test',
      mode: 'path',
      filePath: 'C:/some$$path/c$/session.json',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.prompt).toContain('C:/some$$path/c$/session.json');
      expect(result.data.prompt).not.toContain('{filePath}');
    }
  });

  it('preserves a literal "$&" in message content without re-inserting the placeholder', async () => {
    const tools = new HandoffTools();
    const result = await tools.generateHandoffPrompt({
      sessionId: 'claude:test',
      mode: 'fullText',
      messages: [{ role: 'user', content: 'price is $&5 for the item' }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.prompt).toContain('price is $&5 for the item');
      expect(result.data.prompt).not.toContain('{messages}');
    }
  });
});
