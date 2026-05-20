import { describe, expect, it } from 'vitest'
import { ClaudeExtractor } from '../../core/extractors/ClaudeExtractor'

function extractor() {
  return new ClaudeExtractor() as any
}

// ── JSONL line builders ───────────────────────────────────────────────────────

function userLine(textParts: string[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'user',
    timestamp: '2026-01-01T00:00:00Z',
    message: { role: 'user', content: textParts.map(t => ({ type: 'text', text: t })) },
    ...extra,
  })
}

function assistantLine(textParts: string[]): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-01-01T00:00:01Z',
    message: { role: 'assistant', content: textParts.map(t => ({ type: 'text', text: t })) },
  })
}

function summaryLine(cwd: string): string {
  return JSON.stringify({ type: 'summary', cwd, timestamp: '2026-01-01T00:00:00Z' })
}

// ── parseClaudeJsonlWithMeta ──────────────────────────────────────────────────

describe('ClaudeExtractor.parseClaudeJsonlWithMeta', () => {
  it('parses a user message and assistant reply', () => {
    const raw = [userLine(['Hello']), assistantLine(['Hi there'])].join('\n')
    const { messages } = extractor().parseClaudeJsonlWithMeta(raw)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ role: 'user', content: 'Hello' })
    expect(messages[1]).toMatchObject({ role: 'assistant', content: 'Hi there' })
  })

  it('extracts cwd from the first record that carries it', () => {
    const raw = [summaryLine('/home/user/project'), userLine(['Hi'])].join('\n')
    const { cwd } = extractor().parseClaudeJsonlWithMeta(raw)
    expect(cwd).toBe('/home/user/project')
  })

  it('returns cwd undefined when no record has a cwd field', () => {
    const raw = userLine(['Hi'])
    const { cwd } = extractor().parseClaudeJsonlWithMeta(raw)
    expect(cwd).toBeUndefined()
  })

  it('skips blank lines and lines with invalid JSON', () => {
    const raw = ['', '  ', 'not-json', userLine(['Valid'])].join('\n')
    const { messages } = extractor().parseClaudeJsonlWithMeta(raw)
    expect(messages).toHaveLength(1)
  })

  it('skips tool_result content items silently', () => {
    const raw = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'abc', content: 'result' },
          { type: 'text', text: 'actual user text' },
        ],
      },
    })
    const { messages } = extractor().parseClaudeJsonlWithMeta(raw)
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe('actual user text')
  })

  it('includes thinking-type content items', () => {
    const raw = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'deep thought' }],
      },
    })
    const { messages } = extractor().parseClaudeJsonlWithMeta(raw)
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe('deep thought')
  })

  it('strips angle brackets from text content (leaves other chars intact)', () => {
    const raw = userLine(['<some>tagged</some> text'])
    const { messages } = extractor().parseClaudeJsonlWithMeta(raw)
    // Only < and > are removed; slashes and other characters remain
    expect(messages[0].content).not.toContain('<')
    expect(messages[0].content).not.toContain('>')
    expect(messages[0].content).toContain('tagged')
    expect(messages[0].content).toContain('text')
  })

  it('joins multiple content parts with newline', () => {
    const raw = userLine(['part one', 'part two'])
    const { messages } = extractor().parseClaudeJsonlWithMeta(raw)
    expect(messages[0].content).toBe('part one\npart two')
  })

  it('skips records whose type is not user or assistant', () => {
    const raw = [
      JSON.stringify({ type: 'system', message: { role: 'system', content: [{ type: 'text', text: 'ignored' }] } }),
      userLine(['kept']),
    ].join('\n')
    const { messages } = extractor().parseClaudeJsonlWithMeta(raw)
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe('kept')
  })

  it('skips records whose content produces empty text', () => {
    const raw = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: '   ' }] },
    })
    const { messages } = extractor().parseClaudeJsonlWithMeta(raw)
    expect(messages).toHaveLength(0)
  })
})

// ── slugToWorkspacePath ───────────────────────────────────────────────────────

describe('ClaudeExtractor.slugToWorkspacePath', () => {
  it('converts Windows-style slug back to absolute path', () => {
    const result = extractor().slugToWorkspacePath('c--Users-foo-MyProject')
    expect(result).toMatch(/^C:[/\\]Users[/\\]foo[/\\]MyProject$/)
  })

  it('converts Unix-style slug back to absolute path', () => {
    const result = extractor().slugToWorkspacePath('-home-foo-myproject')
    expect(result).toBe('/home/foo/myproject')
  })

  it('returns undefined for an unrecognised slug format', () => {
    expect(extractor().slugToWorkspacePath('noprefix-slug')).toBeUndefined()
    expect(extractor().slugToWorkspacePath('')).toBeUndefined()
  })
})

// ── isSlugMatchWorkspace ──────────────────────────────────────────────────────

describe('ClaudeExtractor.isSlugMatchWorkspace', () => {
  it('matches when slug contains the normalised workspace path', () => {
    const slug = 'c--Users-kwz50-Edo-Tensei'
    expect(extractor().isSlugMatchWorkspace(slug, 'C:\\Users\\kwz50\\Edo-Tensei')).toBe(true)
  })

  it('matches when normalised workspace path contains the slug', () => {
    // short slug like project name is a substring of the full ws path normalised
    expect(extractor().isSlugMatchWorkspace('edo-tensei', 'C:\\Users\\kwz50\\Edo-Tensei')).toBe(true)
  })

  it('does not match unrelated slug and workspace', () => {
    expect(extractor().isSlugMatchWorkspace('c--Users-other-OtherProject', 'C:\\Users\\kwz50\\Edo-Tensei')).toBe(false)
  })
})
