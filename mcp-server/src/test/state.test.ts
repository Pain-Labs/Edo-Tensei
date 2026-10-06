import { describe, it, expect } from 'vitest';
import { parseState } from '../utils/state.js';

describe('parseState', () => {
  it('returns the stored workspace root', () => {
    expect(parseState('{"lastWorkspaceRoot":"/a/b"}')).toEqual({ lastWorkspaceRoot: '/a/b' });
  });

  it.each(['null', '[]', '42', '"str"', 'true'])('returns empty state for non-object JSON %s', raw => {
    expect(parseState(raw)).toEqual({});
  });

  it('ignores a non-string or empty lastWorkspaceRoot', () => {
    expect(parseState('{"lastWorkspaceRoot":123}')).toEqual({});
    expect(parseState('{"lastWorkspaceRoot":""}')).toEqual({});
  });

  it('still throws on malformed JSON (caller handles it)', () => {
    expect(() => parseState('{oops')).toThrow();
  });
});
