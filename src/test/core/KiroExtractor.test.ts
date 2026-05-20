import { describe, expect, it } from 'vitest'
import { KiroExtractor } from '../../core/extractors/KiroExtractor'

function extractor() {
  return new KiroExtractor() as any
}

// ── isHexHash ─────────────────────────────────────────────────────────────────

describe('KiroExtractor.isHexHash', () => {
  it('accepts a valid 32-character lowercase hex string', () => {
    expect(extractor().isHexHash('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')).toBe(true)
  })

  it('accepts mixed-case hex', () => {
    expect(extractor().isHexHash('A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4')).toBe(true)
  })

  it('rejects strings shorter or longer than 32 characters', () => {
    expect(extractor().isHexHash('a1b2c3')).toBe(false)
    expect(extractor().isHexHash('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4ff')).toBe(false)
  })

  it('rejects strings containing non-hex characters', () => {
    expect(extractor().isHexHash('z1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')).toBe(false)
  })
})

// ── decodeBase64UrlPath ───────────────────────────────────────────────────────

describe('KiroExtractor.decodeBase64UrlPath', () => {
  it('decodes a Base64URL-encoded absolute path', () => {
    const original = '/home/user/MyProject'
    const encoded = Buffer.from(original).toString('base64url')
    expect(extractor().decodeBase64UrlPath(encoded)).toBe(original)
  })

  it('decodes a Windows-style path', () => {
    const original = 'C:\\Users\\kwz50\\Edo-Tensei'
    const encoded = Buffer.from(original).toString('base64url')
    expect(extractor().decodeBase64UrlPath(encoded)).toBe(original)
  })

  it('returns null for an empty encoded string (decodes to empty)', () => {
    // Empty input → decoded empty string → length 0 → null
    expect(extractor().decodeBase64UrlPath('')).toBeNull()
  })

  it('strips the \\x0f separator and trailing ? if present', () => {
    const original = '/home/user/project'
    const withSuffix = original + '\x0f extra-garbage'
    const encoded = Buffer.from(withSuffix).toString('base64url')
    expect(extractor().decodeBase64UrlPath(encoded)).toBe(original)
  })
})

// ── parseLegacyKiroChat ───────────────────────────────────────────────────────

describe('KiroExtractor.parseLegacyKiroChat', () => {
  function chatJson(messages: Array<{ role: string; content: string }>): string {
    return JSON.stringify({ chat: messages })
  }

  it('parses basic user and bot messages', () => {
    const raw = chatJson([
      { role: 'human', content: 'What is the bug?' },
      { role: 'bot', content: 'The bug is in line 42.' },
    ])
    const messages = extractor().parseLegacyKiroChat(raw)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ role: 'user', content: 'What is the bug?' })
    expect(messages[1]).toMatchObject({ role: 'assistant', content: 'The bug is in line 42.' })
  })

  it('skips messages whose role is "tool"', () => {
    const raw = chatJson([
      { role: 'human', content: 'Run the tests' },
      { role: 'tool', content: 'test output here' },
    ])
    const messages = extractor().parseLegacyKiroChat(raw)
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
  })

  it('skips bot acknowledgement-only messages ("On it.", "Understood.", "I will follow these instructions.")', () => {
    const raw = chatJson([
      { role: 'human', content: 'Please fix the auth bug' },
      { role: 'bot', content: 'On it.' },
      { role: 'bot', content: 'Understood.' },
      { role: 'bot', content: 'I will follow these instructions.' },
      { role: 'bot', content: 'Here is what I found.' },
    ])
    const messages = extractor().parseLegacyKiroChat(raw)
    expect(messages).toHaveLength(2)
    expect(messages[1].content).toBe('Here is what I found.')
  })

  it('filters out messages that are pure system-prompt headers', () => {
    const raw = chatJson([
      { role: 'human', content: '# System Prompt\nsome instructions' },
      { role: 'human', content: '<identity>system context</identity>\n<capabilities>...</capabilities>\nActual question?' },
    ])
    const messages = extractor().parseLegacyKiroChat(raw)
    // First message stripped to empty → skipped; second stripped of leading blocks
    const contents = messages.map(m => m.content)
    expect(contents.every(c => !c.includes('<identity>'))).toBe(true)
    expect(contents.every(c => !c.includes('<capabilities>'))).toBe(true)
  })

  it('strips <OPEN-EDITOR-FILES> blocks from user messages', () => {
    const raw = chatJson([{
      role: 'human',
      content: 'Fix the bug\n<OPEN-EDITOR-FILES>foo.ts</OPEN-EDITOR-FILES>',
    }])
    const messages = extractor().parseLegacyKiroChat(raw)
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe('Fix the bug')
  })

  it('strips <EnvironmentContext> when it appears at the end of the message', () => {
    const raw = chatJson([{
      role: 'human',
      content: 'Fix the bug\n<EnvironmentContext>OS: win32</EnvironmentContext>',
    }])
    const messages = extractor().parseLegacyKiroChat(raw)
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe('Fix the bug')
  })

  it('returns empty array for malformed JSON', () => {
    expect(extractor().parseLegacyKiroChat('not-json')).toHaveLength(0)
  })
})

// ── parseWorkspaceSessionJson ─────────────────────────────────────────────────

describe('KiroExtractor.parseWorkspaceSessionJson', () => {
  it('extracts workspaceDirectory and messages with string content', () => {
    const raw = JSON.stringify({
      workspaceDirectory: 'C:\\Users\\kwz50\\MyProject',
      history: [
        { message: { role: 'user', content: 'Hello' } },
        { message: { role: 'assistant', content: 'Hi there' } },
      ],
    })
    const { messages, workspaceDirectory } = extractor().parseWorkspaceSessionJson(raw)
    expect(workspaceDirectory).toBe('C:\\Users\\kwz50\\MyProject')
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ role: 'user', content: 'Hello' })
    expect(messages[1]).toMatchObject({ role: 'assistant', content: 'Hi there' })
  })

  it('extracts messages with ContentPart[] array content', () => {
    const raw = JSON.stringify({
      workspaceDirectory: '/home/user/project',
      history: [{
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'part one' },
            { type: 'text', text: 'part two' },
          ],
        },
      }],
    })
    const { messages } = extractor().parseWorkspaceSessionJson(raw)
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe('part one\npart two')
  })

  it('collects executionIds from history entries', () => {
    const raw = JSON.stringify({
      history: [
        { executionId: 'exec-1', message: { role: 'user', content: 'Do it' } },
        { executionId: 'exec-2', message: { role: 'assistant', content: 'On it.' } },
      ],
    })
    const { executionIds } = extractor().parseWorkspaceSessionJson(raw)
    expect(executionIds).toContain('exec-1')
    expect(executionIds).toContain('exec-2')
  })

  it('skips history entries with empty content', () => {
    const raw = JSON.stringify({
      history: [
        { message: { role: 'user', content: '' } },
        { message: { role: 'user', content: 'Real message' } },
      ],
    })
    const { messages } = extractor().parseWorkspaceSessionJson(raw)
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe('Real message')
  })

  it('returns empty messages and null workspaceDirectory for malformed JSON', () => {
    const { messages, workspaceDirectory } = extractor().parseWorkspaceSessionJson('not-json')
    expect(messages).toHaveLength(0)
    expect(workspaceDirectory).toBeNull()
  })
})

// ── parseFirstUserMessageFromWsSession ────────────────────────────────────────

describe('KiroExtractor.parseFirstUserMessageFromWsSession', () => {
  it('returns the first user message and workspaceDirectory', () => {
    const raw = JSON.stringify({
      workspaceDirectory: '/home/user/project',
      history: [
        { message: { role: 'assistant', content: 'On it.' } },
        { message: { role: 'user', content: 'Fix the test' } },
      ],
    })
    const { firstMsg, workspaceDirectory } = extractor().parseFirstUserMessageFromWsSession(raw)
    expect(workspaceDirectory).toBe('/home/user/project')
    expect(firstMsg).toMatchObject({ role: 'user', content: 'Fix the test' })
  })

  it('returns firstMsg undefined when no user message exists', () => {
    const raw = JSON.stringify({
      workspaceDirectory: '/tmp',
      history: [{ message: { role: 'assistant', content: 'Hello' } }],
    })
    const { firstMsg } = extractor().parseFirstUserMessageFromWsSession(raw)
    expect(firstMsg).toBeUndefined()
  })

  it('handles ContentPart[] array content in user message', () => {
    const raw = JSON.stringify({
      history: [{
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'array content' }],
        },
      }],
    })
    const { firstMsg } = extractor().parseFirstUserMessageFromWsSession(raw)
    expect(firstMsg?.content).toBe('array content')
  })

  it('returns null workspaceDirectory for malformed JSON', () => {
    const { workspaceDirectory } = extractor().parseFirstUserMessageFromWsSession('bad json')
    expect(workspaceDirectory).toBeNull()
  })
})
