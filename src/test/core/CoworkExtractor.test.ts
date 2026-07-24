import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFile, mkdir, mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { CoworkExtractor } from '../../core/extractors/CoworkExtractor'

function ext() {
  return new CoworkExtractor() as any
}

// ── JSONL record builders ─────────────────────────────────────────────────────

function userRecord(content: string, ts = '2026-01-01T00:00:00Z'): string {
  return JSON.stringify({ type: 'user', _audit_timestamp: ts, message: { role: 'user', content } })
}

function assistantRecord(
  blocks: Array<{ type: string; text?: string; thinking?: string }>,
  ts = '2026-01-01T00:00:01Z',
): string {
  return JSON.stringify({ type: 'assistant', _audit_timestamp: ts, message: { role: 'assistant', content: blocks } })
}

// ── recordToMessage ───────────────────────────────────────────────────────────

describe('CoworkExtractor.recordToMessage', () => {
  it('parses a user record with plain string content', () => {
    const msg = ext().recordToMessage({
      type: 'user',
      _audit_timestamp: '2026-01-01T00:00:00Z',
      message: { role: 'user', content: 'Hello world' },
    })
    expect(msg).toMatchObject({ role: 'user', content: 'Hello world', timestamp: '2026-01-01T00:00:00Z' })
  })

  it('extracts only text blocks from assistant — skips thinking blocks', () => {
    const msg = ext().recordToMessage({
      type: 'assistant',
      _audit_timestamp: '2026-01-01T00:00:01Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'internal reasoning that should be hidden' },
          { type: 'text', text: 'Visible reply' },
        ],
      },
    })
    expect(msg?.content).toBe('Visible reply')
    expect(msg?.content).not.toContain('internal reasoning')
  })

  it('joins multiple text blocks with newline', () => {
    const msg = ext().recordToMessage({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Part one' },
          { type: 'text', text: 'Part two' },
        ],
      },
    })
    expect(msg?.content).toBe('Part one\nPart two')
  })

  it('returns undefined when all assistant blocks are thinking-only', () => {
    const msg = ext().recordToMessage({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'only thoughts' }] },
    })
    expect(msg).toBeUndefined()
  })

  it.each(['system', 'result', 'rate_limit_event'])(
    'returns undefined for record type "%s"',
    (type) => {
      expect(ext().recordToMessage({ type, message: { content: 'ignored' } })).toBeUndefined()
    },
  )

  it('returns undefined when user content is whitespace-only', () => {
    expect(ext().recordToMessage({ type: 'user', message: { content: '   ' } })).toBeUndefined()
  })

  it('returns undefined when assistant content array is empty', () => {
    expect(ext().recordToMessage({ type: 'assistant', message: { content: [] } })).toBeUndefined()
  })

  it('forwards _audit_timestamp as message timestamp', () => {
    const msg = ext().recordToMessage({
      type: 'user',
      _audit_timestamp: '2026-06-15T10:30:00Z',
      message: { content: 'hi' },
    })
    expect(msg?.timestamp).toBe('2026-06-15T10:30:00Z')
  })

  it('truncates content when maxChars is specified', () => {
    const longText = 'A'.repeat(200)
    const msg = ext().recordToMessage({ type: 'user', message: { content: longText } }, 50)
    expect(msg?.content).toContain('[truncated')
    expect(msg?.content.length).toBeLessThan(longText.length)
  })
})

// ── System injection filtering ────────────────────────────────────────────────

describe('CoworkExtractor system injection filtering via recordToMessage', () => {
  it.each([
    'Task "Install package" completed. Use read_transcript to continue.',
    'You ended the turn without calling any tools.',
    "You've hit your session limit for this period.",
    'You have 3 tasks remaining.',
    'SendUserMessage called with invalid args.',
  ])('filters system injection: "%s"', (text) => {
    const msg = ext().recordToMessage({ type: 'user', message: { content: text } })
    expect(msg).toBeUndefined()
  })
})

// ── File-based tests (parseAuditJsonl, prescanFirstUserMessage, readChildMeta) ─

describe('CoworkExtractor file-based', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'cowork-test-'))
  })
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // ── parseAuditJsonl ─────────────────────────────────────────────────────────

  describe('parseAuditJsonl', () => {
    it('parses user and assistant messages from JSONL', async () => {
      const file = join(tmpDir, 'audit.jsonl')
      await writeFile(
        file,
        [userRecord('Hello'), assistantRecord([{ type: 'text', text: 'Hi there' }])].join('\n'),
      )
      const messages = await ext().parseAuditJsonl(file)
      expect(messages).toHaveLength(2)
      expect(messages[0]).toMatchObject({ role: 'user', content: 'Hello' })
      expect(messages[1]).toMatchObject({ role: 'assistant', content: 'Hi there' })
    })

    it('deduplicates identical messages within 60 seconds', async () => {
      const ts1 = '2026-01-01T00:00:00Z'
      const ts2 = '2026-01-01T00:00:07Z' // Cowork dispatch echo is typically ~7s
      const file = join(tmpDir, 'audit.jsonl')
      await writeFile(file, [userRecord('Same message', ts1), userRecord('Same message', ts2)].join('\n'))
      const messages = await ext().parseAuditJsonl(file)
      expect(messages).toHaveLength(1)
      expect(messages[0].content).toBe('Same message')
    })

    it('allows same content again after the 60-second dedup window', async () => {
      const ts1 = '2026-01-01T00:00:00Z'
      const ts2 = '2026-01-01T00:01:30Z'
      const file = join(tmpDir, 'audit.jsonl')
      await writeFile(file, [userRecord('Same message', ts1), userRecord('Same message', ts2)].join('\n'))
      const messages = await ext().parseAuditJsonl(file)
      expect(messages).toHaveLength(2)
    })

    it('always accepts different content regardless of timing', async () => {
      const ts = '2026-01-01T00:00:00Z'
      const file = join(tmpDir, 'audit.jsonl')
      await writeFile(
        file,
        [userRecord('Message A', ts), userRecord('Message B', ts), userRecord('Message C', ts)].join('\n'),
      )
      const messages = await ext().parseAuditJsonl(file)
      expect(messages).toHaveLength(3)
    })

    it('filters out system injection user messages', async () => {
      const file = join(tmpDir, 'audit.jsonl')
      await writeFile(
        file,
        [
          userRecord('Real question from human'),
          userRecord('Task "Install" completed. Use read_transcript to proceed.'),
          assistantRecord([{ type: 'text', text: 'Real reply' }]),
        ].join('\n'),
      )
      const messages = await ext().parseAuditJsonl(file)
      expect(messages).toHaveLength(2)
      expect(messages.some((m: { content: string }) => m.content.startsWith('Task'))).toBe(false)
    })

    it('excludes thinking blocks from assistant output', async () => {
      const file = join(tmpDir, 'audit.jsonl')
      await writeFile(
        file,
        assistantRecord([
          { type: 'thinking', thinking: 'internal reasoning' },
          { type: 'text', text: 'Here is my answer.' },
        ]),
      )
      const messages = await ext().parseAuditJsonl(file)
      expect(messages).toHaveLength(1)
      expect(messages[0].content).toBe('Here is my answer.')
      expect(messages[0].content).not.toContain('internal reasoning')
    })

    it('skips blank lines and invalid JSON silently', async () => {
      const file = join(tmpDir, 'audit.jsonl')
      await writeFile(file, ['', '  ', 'not-json', '{incomplete', userRecord('Valid message')].join('\n'))
      const messages = await ext().parseAuditJsonl(file)
      expect(messages).toHaveLength(1)
      expect(messages[0].content).toBe('Valid message')
    })

    it.each(['system', 'result'])(
      'skips records of type "%s"',
      async (type) => {
        const file = join(tmpDir, 'audit.jsonl')
        await writeFile(
          file,
          [JSON.stringify({ type, message: { content: 'ignored' } }), userRecord('Kept')].join('\n'),
        )
        const messages = await ext().parseAuditJsonl(file)
        expect(messages).toHaveLength(1)
        expect(messages[0].content).toBe('Kept')
      },
    )

    it('returns empty array when file does not exist', async () => {
      const messages = await ext().parseAuditJsonl(join(tmpDir, 'nonexistent.jsonl'))
      expect(messages).toEqual([])
    })
  })

  // ── prescanFirstUserMessage ─────────────────────────────────────────────────

  describe('prescanFirstUserMessage', () => {
    it('returns the first real user message', async () => {
      const file = join(tmpDir, 'audit.jsonl')
      await writeFile(
        file,
        [userRecord('First real question'), assistantRecord([{ type: 'text', text: 'Reply' }])].join('\n'),
      )
      const msg = await ext().prescanFirstUserMessage(file)
      expect(msg).toMatchObject({ role: 'user', content: 'First real question' })
    })

    it('skips system injection lines and returns first genuine user message', async () => {
      const file = join(tmpDir, 'audit.jsonl')
      await writeFile(
        file,
        [
          userRecord('Task "Init" completed. Use read_transcript to proceed.'),
          userRecord('You ended the turn without calling any tools.'),
          userRecord('Actual human question'),
        ].join('\n'),
      )
      const msg = await ext().prescanFirstUserMessage(file)
      expect(msg?.content).toBe('Actual human question')
    })

    it('returns undefined when no user message exists', async () => {
      const file = join(tmpDir, 'audit.jsonl')
      await writeFile(file, assistantRecord([{ type: 'text', text: 'Only assistant speaking' }]))
      const msg = await ext().prescanFirstUserMessage(file)
      expect(msg).toBeUndefined()
    })

    it('returns undefined when file does not exist', async () => {
      const msg = await ext().prescanFirstUserMessage(join(tmpDir, 'missing.jsonl'))
      expect(msg).toBeUndefined()
    })
  })

  // ── readChildMeta ───────────────────────────────────────────────────────────

  describe('readChildMeta', () => {
    it('reads title and lastActivityAt from a child session JSON file', async () => {
      const file = join(tmpDir, 'local_abc123.json')
      await writeFile(file, JSON.stringify({ title: 'Test session', lastActivityAt: 1750000000000 }))
      const meta = await ext().readChildMeta(file)
      expect(meta.title).toBe('Test session')
      expect(meta.lastActivityAt).toBe(1750000000000)
    })

    it('returns empty object when file does not exist', async () => {
      const meta = await ext().readChildMeta(join(tmpDir, 'nonexistent.json'))
      expect(meta).toEqual({})
    })

    it('returns empty object for malformed JSON', async () => {
      const file = join(tmpDir, 'bad.json')
      await writeFile(file, 'not valid json {{')
      const meta = await ext().readChildMeta(file)
      expect(meta).toEqual({})
    })
  })

  // ── getWindowsMsixScanPaths ───────────────────────────────────────────────────
  // Regression: Claude Desktop installed via the Microsoft Store (MSIX/AppX)
  // runs in an AppContainer, so Windows redirects its "%APPDATA%" writes into
  // an isolated per-package sandbox instead of the real %APPDATA%\Claude.
  // process.env.APPDATA alone never resolves to real session data in that
  // case — confirmed against a real Windows install with a live Cowork
  // session that CoworkExtractor was otherwise unable to find.
  describe('getWindowsMsixScanPaths', () => {
    let localAppData: string
    let origLocalAppData: string | undefined

    beforeEach(async () => {
      localAppData = await mkdtemp(join(tmpdir(), 'edotensei-msix-'))
      origLocalAppData = process.env.LOCALAPPDATA
      process.env.LOCALAPPDATA = localAppData
    })

    afterEach(async () => {
      process.env.LOCALAPPDATA = origLocalAppData
      await rm(localAppData, { recursive: true, force: true })
    })

    it('finds local-agent-mode-sessions under a Claude_<publisherId> MSIX package', async () => {
      const sessionsDir = join(localAppData, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude', 'local-agent-mode-sessions')
      await mkdir(sessionsDir, { recursive: true })

      const paths = ext().getWindowsMsixScanPaths()
      expect(paths).toContain(sessionsDir)
    })

    it('ignores unrelated packages and unrelated Claude-prefixed packages without a hyphen boundary', async () => {
      await mkdir(join(localAppData, 'Packages', 'Microsoft.WindowsTerminal_abc'), { recursive: true })
      await mkdir(join(localAppData, 'Packages', 'Claude-3p'), { recursive: true })

      const paths = ext().getWindowsMsixScanPaths()
      expect(paths).toEqual([])
    })

    it('skips a Claude package that has no local-agent-mode-sessions data', async () => {
      await mkdir(join(localAppData, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache'), { recursive: true })

      const paths = ext().getWindowsMsixScanPaths()
      expect(paths).toEqual([])
    })

    it('returns an empty array when the Packages directory does not exist', async () => {
      await rm(join(localAppData, 'Packages'), { recursive: true, force: true })
      const paths = ext().getWindowsMsixScanPaths()
      expect(paths).toEqual([])
    })

    it('returns an empty array when LOCALAPPDATA is not set', () => {
      delete process.env.LOCALAPPDATA
      const paths = ext().getWindowsMsixScanPaths()
      expect(paths).toEqual([])
    })
  })
})
