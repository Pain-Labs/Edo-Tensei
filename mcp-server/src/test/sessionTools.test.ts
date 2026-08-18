import { describe, it, expect } from 'vitest';
import { SessionTools } from '../tools/sessionTools.js';

describe('SessionTools - parseTimeExpression date parsing', () => {
  // #76: single-digit month/day dates (e.g. "2026-8-1") were silently
  // dropped — `parseDate` built `${input}T00:00:00` directly, and V8's
  // strict ISO-8601 parser rejects a non-zero-padded month/day, so the
  // whole date filter was ignored rather than applied.
  it('parses a single date with single-digit month/day', () => {
    const tools = new SessionTools();
    const result = (tools as any).parseTimeExpression('2026-8-1');

    expect(result).toBeDefined();
    expect(result.start.getFullYear()).toBe(2026);
    expect(result.start.getMonth()).toBe(7); // August, 0-indexed
    expect(result.start.getDate()).toBe(1);
  });

  it('parses a date range with single-digit month/day on both ends', () => {
    const tools = new SessionTools();
    const result = (tools as any).parseTimeExpression('2026/5/1 to 2026/5/3');

    expect(result).toBeDefined();
    expect(result.start.getMonth()).toBe(4); // May, 0-indexed
    expect(result.start.getDate()).toBe(1);
    expect(result.end.getDate()).toBe(3);
  });

  it('still parses zero-padded dates as before', () => {
    const tools = new SessionTools();
    const result = (tools as any).parseTimeExpression('2026-08-01');

    expect(result).toBeDefined();
    expect(result.start.getMonth()).toBe(7);
    expect(result.start.getDate()).toBe(1);
  });

  it('returns undefined for a malformed date', () => {
    const tools = new SessionTools();
    const result = (tools as any).parseTimeExpression('2026-13-99');

    expect(result).toBeUndefined();
  });
});
