import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexExtractor } from '../../core/extractors/CodexExtractor'
import { SessionHandoffProvider } from '../../ui/SessionHandoffProvider'

type ParsedMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: string
}

function legacyIsCodexInjectedMessage(role: string, text: string): boolean {
  if (role === 'developer' || role === 'system') return true

  const stripped = text.trimStart()

  if (stripped.startsWith('<turn_aborted>')) return true

  const injectedPrefixes = [
    '<permissions instructions>',
    '<collaboration_mode>',
    '<skills_instructions>',
    '<environment_context>',
    '# AGENTS.md instructions for',
  ]

  if (injectedPrefixes.some(prefix => stripped.startsWith(prefix))) {
    const withoutTags = text
      .replace(/<[a-z_]+>[\s\S]*?<\/[a-z_]+>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/^#+\s+AGENTS\.md[^\n]*/gm, '')
      .trim()

    return withoutTags.length < 50
  }

  return false
}

function parseWithLegacyCodexInjectedFilter(raw: string): ParsedMessage[] {
  const messages: ParsedMessage[] = []

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let obj: any
    try {
      obj = JSON.parse(trimmed)
    } catch {
      continue
    }

    if (obj.type !== 'response_item') continue

    const payload = obj.payload || {}
    if (payload.type !== 'message') continue

    const role = payload.role
    if (role !== 'user' && role !== 'assistant' && role !== 'developer' && role !== 'system') continue

    const contentArr = payload.content
    if (!Array.isArray(contentArr)) continue

    const text = contentArr
      .map((content: any) => {
        if (!content) return ''
        if (typeof content.text === 'string') return content.text
        if (typeof content.input_text === 'string') return content.input_text
        return ''
      })
      .join('')
      .trim()

    if (!text) continue

    if (role === 'user' && text.trimStart().startsWith('# Context from my IDE setup:')) {
      const marker = '## My request for Codex:'
      const markerIndex = text.indexOf(marker)
      if (markerIndex !== -1) {
        const requestText = text.slice(markerIndex + marker.length).trim()
        if (requestText) {
          messages.push({ role: 'user', content: requestText, timestamp: obj.timestamp })
        }
      }
      continue
    }

    if (legacyIsCodexInjectedMessage(role, text)) continue

    const mappedRole: ParsedMessage['role'] = role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'system'
    messages.push({ role: mappedRole, content: text, timestamp: obj.timestamp })
  }

  return messages
}

function codexMessage(timestamp: string, role: string, text: string): string {
  return JSON.stringify({
    timestamp,
    type: 'response_item',
    payload: {
      type: 'message',
      role,
      content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }],
    },
  })
}

function codexMeta(cwd?: string, id = 'codex-session'): string {
  return JSON.stringify({
    timestamp: '2026-05-16T00:59:59.000Z',
    type: 'session_meta',
    payload: {
      id,
      ...(cwd ? { cwd } : {}),
    },
  })
}

async function withTempCodexHome<T>(run: (dirs: { tempRoot: string; homeDir: string }) => Promise<T>): Promise<T> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'edo-tensei-codex-test-'))
  const homeDir = path.join(tempRoot, 'home')
  await fs.mkdir(homeDir, { recursive: true })

  try {
    return await run({ tempRoot, homeDir })
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
}

function createIsolatedCodexExtractor(homeDir: string): CodexExtractor {
  const extractor = new CodexExtractor() as any
  extractor.getSessionsDir = () => path.join(homeDir, '.codex', 'sessions')
  return extractor as CodexExtractor
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('angle bracket sanitization', () => {
  it('does not reconstruct angle-bracket tags while extracting tree titles', () => {
    const title = SessionHandoffProvider.extractMeaningfulTitle([
      {
        role: 'user',
        content: '<scr<script>ipt>alert(1)</scr<script>ipt>',
      },
    ])

    expect(title).not.toContain('<')
    expect(title).not.toContain('>')
  })

  it('filters pure Codex injected blocks without multi-character tag sanitizers', () => {
    const extractor = new CodexExtractor()
    const injected = [
      '<environment_context>',
      '<cwd>C:\\Users\\kwz50\\Edo-Tensei</cwd>',
      '<shell>powershell</shell>',
      '</environment_context>',
    ].join('\n')

    expect((extractor as any).isCodexInjectedMessage('user', injected)).toBe(true)
  })

  it('keeps Codex messages when injected scaffolding is followed by user content', () => {
    const extractor = new CodexExtractor()
    const mixedMessage = [
      '<environment_context>',
      '<cwd>C:\\Users\\kwz50\\Edo-Tensei</cwd>',
      '</environment_context>',
      'Please analyze the security alert and update the implementation with tests.',
    ].join('\n')

    expect((extractor as any).isCodexInjectedMessage('user', mixedMessage)).toBe(false)
  })

  it('filters pure permissions blocks that the legacy sanitizer could leak', () => {
    const extractor = new CodexExtractor()
    const permissionsBlock = [
      '<permissions instructions>',
      'Filesystem sandboxing defines which files can be read or written. Network access is restricted.',
      '</permissions instructions>',
    ].join('\n')

    expect(legacyIsCodexInjectedMessage('user', permissionsBlock)).toBe(false)
    expect((extractor as any).isCodexInjectedMessage('user', permissionsBlock)).toBe(true)
  })

  it('preserves legacy Codex rollout output for canonical injected scaffolding', () => {
    const extractor = new CodexExtractor()
    const rawRollout = [
      codexMessage('2026-05-16T01:00:00.000Z', 'developer', 'You are Codex, a coding agent.'),
      codexMessage('2026-05-16T01:00:01.000Z', 'user', [
        '<environment_context>',
        '<cwd>C:\\Users\\kwz50\\Edo-Tensei</cwd>',
        '<shell>powershell</shell>',
        '</environment_context>',
      ].join('\n')),
      codexMessage('2026-05-16T01:00:03.000Z', 'user', [
        '# AGENTS.md instructions for c:\\Users\\kwz50\\Edo-Tensei',
        '',
        '<INSTRUCTIONS>',
        '任務報告或規劃文件皆優先以中文撰寫',
        '</INSTRUCTIONS>',
      ].join('\n')),
      codexMessage('2026-05-16T01:00:04.000Z', 'user', [
        '# Context from my IDE setup:',
        '',
        '## My request for Codex:',
        'Please add tests for the staged change.',
      ].join('\n')),
      codexMessage('2026-05-16T01:00:05.000Z', 'assistant', 'I will inspect the staged diff and add focused tests.'),
      codexMessage('2026-05-16T01:00:06.000Z', 'user', [
        '<environment_context>',
        '<cwd>C:\\Users\\kwz50\\Edo-Tensei</cwd>',
        '</environment_context>',
        'This is actual user content that must remain because it is longer than fifty characters.',
      ].join('\n')),
    ].join('\n')

    const currentOutput = (extractor as any).parseCodexRollout(rawRollout).messages
    const legacyOutput = parseWithLegacyCodexInjectedFilter(rawRollout)

    expect(currentOutput).toEqual(legacyOutput)
    expect(currentOutput).toEqual([
      {
        role: 'user',
        content: 'Please add tests for the staged change.',
        timestamp: '2026-05-16T01:00:04.000Z',
      },
      {
        role: 'assistant',
        content: 'I will inspect the staged diff and add focused tests.',
        timestamp: '2026-05-16T01:00:05.000Z',
      },
      {
        role: 'user',
        content: [
          '<environment_context>',
          '<cwd>C:\\Users\\kwz50\\Edo-Tensei</cwd>',
          '</environment_context>',
          'This is actual user content that must remain because it is longer than fifty characters.',
        ].join('\n'),
        timestamp: '2026-05-16T01:00:06.000Z',
      },
    ])
  })

  it('removes every supported injected scaffolding block and strips remaining angle brackets', () => {
    const extractor = new CodexExtractor()
    const stripped = (extractor as any).stripCodexInjectedScaffolding([
      '<COLLABORATION_MODE>Default</COLLABORATION_MODE>',
      'before',
      '<skills_instructions>',
      'skill list',
      '</skills_instructions>',
      '<permissions instructions>',
      'sandbox rules',
      '</permissions instructions>',
      '# AGENTS.md instructions for c:\\Users\\kwz50\\Edo-Tensei',
      '<environment_context>',
      '<cwd>C:\\Users\\kwz50\\Edo-Tensei</cwd>',
      '</environment_context>',
      '<actual user text>',
    ].join('\n'))

    expect(stripped.split(/\n+/)).toEqual(['before', 'actual user text'])
  })

  it('handles marked-block removal around surrounding content and missing close markers', () => {
    const extractor = new CodexExtractor()

    expect((extractor as any).removeMarkedBlocks(
      'keep <environment_context>drop</ENVIRONMENT_CONTEXT> keep2',
      '<environment_context>',
      '</environment_context>',
    )).toBe('keep  keep2')

    expect((extractor as any).removeMarkedBlocks(
      'keep <environment_context>drop',
      '<environment_context>',
      '</environment_context>',
    )).toBe('keep ')
  })

  it('covers Codex injected-message role and prefix decisions', () => {
    const extractor = new CodexExtractor()

    expect((extractor as any).isCodexInjectedMessage('developer', 'developer rules')).toBe(true)
    expect((extractor as any).isCodexInjectedMessage('system', 'system rules')).toBe(true)
    expect((extractor as any).isCodexInjectedMessage('user', '<turn_aborted>')).toBe(true)
    expect((extractor as any).isCodexInjectedMessage('user', 'ordinary user prompt')).toBe(false)
    expect((extractor as any).isCodexInjectedMessage('user', [
      '<collaboration_mode>',
      'Default',
      '</collaboration_mode>',
    ].join('\n'))).toBe(true)
    expect((extractor as any).isCodexInjectedMessage('user', [
      '<skills_instructions>',
      'Skill list',
      '</skills_instructions>',
    ].join('\n'))).toBe(true)
  })

  it('parses Codex rollout records while skipping malformed and injected entries', () => {
    const extractor = new CodexExtractor()
    const rawRollout = [
      '',
      '{bad json',
      JSON.stringify({ type: 'event_msg', payload: { message: 'ignore' } }),
      JSON.stringify({ payload: { type: 'message' } }),
      JSON.stringify({ type: 'session_meta' }),
      codexMeta('C:\\Work\\Edo-Tensei', 'session-123'),
      JSON.stringify({ type: 'response_item' }),
      JSON.stringify({ type: 'response_item', payload: { type: 'tool_call', role: 'assistant', content: [] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'tool', content: [] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: 'not array' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [null] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ nope: true }] } }),
      codexMessage('2026-05-16T01:00:00.000Z', 'user', [
        '# Context from my IDE setup:',
        '',
        'No request marker here.',
      ].join('\n')),
      codexMessage('2026-05-16T01:00:01.000Z', 'user', [
        '# Context from my IDE setup:',
        '',
        '## My request for Codex:',
        '   ',
      ].join('\n')),
      codexMessage('2026-05-16T01:00:02.000Z', 'developer', 'developer rules'),
      codexMessage('2026-05-16T01:00:03.000Z', 'system', 'system rules'),
      JSON.stringify({
        timestamp: '2026-05-16T01:00:04.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [
            { input_text: 'Hello ' },
            { text: 'from Codex' },
          ],
        },
      }),
      codexMessage('2026-05-16T01:00:05.000Z', 'assistant', 'Assistant response'),
    ].join('\n')

    expect((extractor as any).parseCodexRollout(rawRollout)).toEqual({
      cwd: 'C:\\Work\\Edo-Tensei',
      sessionId: 'session-123',
      title: undefined,
      messages: [
        {
          role: 'user',
          content: 'Hello from Codex',
          timestamp: '2026-05-16T01:00:04.000Z',
        },
        {
          role: 'assistant',
          content: 'Assistant response',
          timestamp: '2026-05-16T01:00:05.000Z',
        },
      ],
    })
  })

  it('maps non-user and non-assistant kept records to system messages defensively', () => {
    const extractor = new CodexExtractor()
    // This simulates a future change where system messages are allowed through
    // after the injection filter. They must still be normalized to the safe
    // display role instead of being exposed as user or assistant messages.
    vi.spyOn(extractor as any, 'isCodexInjectedMessage').mockReturnValue(false)

    expect((extractor as any).parseCodexRollout(codexMessage(
      '2026-05-16T01:00:00.000Z',
      'system',
      'kept system content',
    )).messages).toEqual([
      {
        role: 'system',
        content: 'kept system content',
        timestamp: '2026-05-16T01:00:00.000Z',
      },
    ])
  })


  it('extracts Codex rollout files, filters by workspace, and returns empty fallback sessions', async () => {
    await withTempCodexHome(async ({ tempRoot, homeDir }) => {
      const extractor = createIsolatedCodexExtractor(homeDir)
      const scanRoot = path.join(tempRoot, 'scan')
      const nestedRoot = path.join(scanRoot, '2026', '05', '16')
      await fs.mkdir(nestedRoot, { recursive: true })

      const matchingPath = path.join(nestedRoot, 'rollout-matching.jsonl')
      const olderPath = path.join(nestedRoot, 'rollout-older.jsonl')
      const noMessagesPath = path.join(nestedRoot, 'rollout-empty.jsonl')
      const smallPath = path.join(nestedRoot, 'rollout-small.jsonl')
      await fs.writeFile(matchingPath, [
        codexMeta('C:\\Work\\Edo-Tensei', 'matching'),
        codexMessage('2026-05-16T01:00:00.000Z', 'user', 'Please keep this Codex session.'),
      ].join('\n'))
      await fs.writeFile(olderPath, [
        codexMeta('C:\\Work\\Edo-Tensei', 'older'),
        codexMessage('2026-05-16T00:00:00.000Z', 'user', 'Older session.'),
      ].join('\n'))
      await fs.writeFile(noMessagesPath, [
        codexMeta('C:\\Work\\Edo-Tensei', 'empty'),
        codexMessage('2026-05-16T01:00:00.000Z', 'developer', 'developer rules'),
        codexMessage('2026-05-16T01:00:01.000Z', 'system', 'system rules'),
      ].join('\n'))
      await fs.writeFile(smallPath, 'tiny')

      const newerDate = new Date('2026-05-16T02:00:00.000Z')
      const olderDate = new Date('2026-05-16T01:00:00.000Z')
      await fs.utimes(matchingPath, newerDate, newerDate)
      await fs.utimes(olderPath, olderDate, olderDate)

      const sessions = await extractor.extractAll('C:\\Work', [path.join(tempRoot, 'missing'), scanRoot])
      expect(sessions).toHaveLength(2)
      expect(sessions.map(session => session.sessionId)).toEqual(['matching', 'older'])
      expect(sessions[0]).toMatchObject({
        sourceIde: 'codex',
        workspacePath: 'C:\\Work\\Edo-Tensei',
        rawPath: matchingPath,
        readStatus: 'success',
      })
      expect(sessions[0].messages).toEqual([
        {
          role: 'user',
          content: 'Please keep this Codex session.',
          timestamp: '2026-05-16T01:00:00.000Z',
        },
      ])
      expect(sessions[0].fileSizeBytes).toBeGreaterThan(200)

      await expect(extractor.extractAll('C:\\Other', [scanRoot])).resolves.toEqual([])

      const firstSession = await extractor.extract('C:\\Work', [scanRoot])
      expect(firstSession.sessionId).toBe('matching')

      const emptySession = await extractor.extract(undefined, [])
      expect(emptySession).toMatchObject({
        sourceIde: 'codex',
        messages: [],
        readStatus: 'empty',
      })
      expect(emptySession.rawPath.replace(/\\/g, '/')).toContain('/home/.codex/sessions')
    })
  })

  it('falls back to file-path workspace filtering when rollout cwd is unavailable', async () => {
    await withTempCodexHome(async ({ tempRoot, homeDir }) => {
      const extractor = createIsolatedCodexExtractor(homeDir)
      const scanRoot = path.join(tempRoot, 'workspace-match')
      await fs.mkdir(scanRoot, { recursive: true })
      const rolloutPath = path.join(scanRoot, 'rollout-no-cwd.jsonl')
      await fs.writeFile(rolloutPath, [
        codexMeta(undefined, 'no-cwd'),
        codexMessage('2026-05-16T01:00:00.000Z', 'user', 'No cwd session content.'),
      ].join('\n'))

      await expect(extractor.extractAll(scanRoot, [scanRoot])).resolves.toHaveLength(1)
      await expect(extractor.extractAll(undefined, [scanRoot])).resolves.toHaveLength(1)
      await expect(extractor.extractAll(path.join(tempRoot, 'other-workspace'), [scanRoot])).resolves.toEqual([])
    })
  })

  it('handles private filesystem helper failures without surfacing exceptions', async () => {
    await withTempCodexHome(async ({ tempRoot, homeDir }) => {
      const extractor = createIsolatedCodexExtractor(homeDir)
      const scanRoot = path.join(tempRoot, 'scan')
      await fs.mkdir(scanRoot, { recursive: true })

      await expect((extractor as any).safeStat(path.join(tempRoot, 'missing.jsonl'))).resolves.toBeUndefined()
      await expect((extractor as any).safeReadFile(path.join(tempRoot, 'missing.jsonl'))).resolves.toBeUndefined()
      await expect((extractor as any).findRolloutFiles(path.join(tempRoot, 'missing-dir'))).resolves.toEqual([])

      const statless = createIsolatedCodexExtractor(homeDir) as any
      statless.findRolloutFiles = async () => [path.join(scanRoot, 'rollout-statless.jsonl')]
      statless.safeStat = async () => undefined
      await expect(statless.extractAll(undefined, [scanRoot])).resolves.toEqual([])

      const unreadable = createIsolatedCodexExtractor(homeDir) as any
      unreadable.findRolloutFiles = async () => [path.join(scanRoot, 'rollout-unreadable.jsonl')]
      unreadable.safeStat = async () => ({ size: 250, mtimeMs: Date.parse('2026-05-16T01:00:00.000Z') })
      unreadable.safeReadFile = async () => undefined
      await expect(unreadable.extractAll(undefined, [scanRoot])).resolves.toEqual([])
    })
  })

  it('uses the default Codex sessions path for empty extraction results', async () => {
    await withTempCodexHome(async ({ homeDir }) => {
      const extractor = createIsolatedCodexExtractor(homeDir)

      const session = await extractor.extract(undefined, [])

      expect(session).toMatchObject({
        sourceIde: 'codex',
        messages: [],
        rawPath: path.join(homeDir, '.codex', 'sessions'),
        readStatus: 'empty',
      })
    })
  })

  it('ignores files that do not match the Codex rollout filename pattern', async () => {
    await withTempCodexHome(async ({ tempRoot, homeDir }) => {
      const extractor = createIsolatedCodexExtractor(homeDir)
      const scanRoot = path.join(tempRoot, 'scan')
      await fs.mkdir(scanRoot, { recursive: true })
      await fs.writeFile(path.join(scanRoot, 'notes.jsonl'), 'not a rollout')

      await expect((extractor as any).findRolloutFiles(scanRoot)).resolves.toEqual([])
    })
  })

  it('ignores symlinked rollout-looking entries during filesystem discovery', async () => {
    await withTempCodexHome(async ({ tempRoot, homeDir }) => {
      const extractor = createIsolatedCodexExtractor(homeDir)
      const scanRoot = path.join(tempRoot, 'scan')
      const targetPath = path.join(scanRoot, 'real-rollout.jsonl')
      const linkPath = path.join(scanRoot, 'rollout-symlink.jsonl')
      await fs.mkdir(scanRoot, { recursive: true })
      await fs.writeFile(targetPath, [
        codexMeta('C:\\Work\\Edo-Tensei', 'real'),
        codexMessage('2026-05-16T01:00:00.000Z', 'user', 'Real target.'),
      ].join('\n'))

      try {
        await fs.symlink(targetPath, linkPath)
      } catch (error: any) {
        if (error?.code === 'EPERM' || error?.code === 'EACCES') {
          return
        }
        throw error
      }

      await expect((extractor as any).findRolloutFiles(scanRoot)).resolves.toEqual([])
    })
  })

  it('does not walk rollout files beyond the configured recursion depth', async () => {
    await withTempCodexHome(async ({ tempRoot, homeDir }) => {
      const extractor = createIsolatedCodexExtractor(homeDir)
      let deepRoot = path.join(tempRoot, 'deep')
      for (let i = 0; i < 7; i += 1) {
        deepRoot = path.join(deepRoot, `level-${i}`)
      }

      await fs.mkdir(deepRoot, { recursive: true })
      await fs.writeFile(path.join(deepRoot, 'rollout-too-deep.jsonl'), [
        codexMeta('C:\\Work\\Edo-Tensei', 'too-deep'),
        codexMessage('2026-05-16T01:00:00.000Z', 'user', 'Too deep.'),
      ].join('\n'))

      await expect((extractor as any).findRolloutFiles(path.join(tempRoot, 'deep'))).resolves.toEqual([])
    })
  })
})
