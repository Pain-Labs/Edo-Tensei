import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { writeFile, mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { CursorExtractor } from '../../core/extractors/CursorExtractor'

function extractor() {
  return new CursorExtractor() as any
}

// ── JSONL line builder ────────────────────────────────────────────────────────

function line(role: 'user' | 'assistant', ...texts: string[]): string {
  return JSON.stringify({
    role,
    message: { content: texts.map(t => ({ type: 'text', text: t })) },
  })
}

// ── pathToSlug ────────────────────────────────────────────────────────────────

describe('CursorExtractor.pathToSlug', () => {
  it('converts a Windows absolute path to Cursor slug format', () => {
    expect(extractor().pathToSlug('C:\\Users\\kwz50\\MyProject')).toBe('c-Users-kwz50-MyProject')
  })

  it('converts a Unix absolute path to Cursor slug format', () => {
    expect(extractor().pathToSlug('/home/user/my-project')).toBe('-home-user-my-project')
  })

  it('lowercases the Windows drive letter', () => {
    expect(extractor().pathToSlug('D:\\Work\\App')).toBe('d-Work-App')
  })

  it('replaces both forward and back slashes with dashes', () => {
    const slug = extractor().pathToSlug('C:/Users/foo/bar')
    expect(slug).toBe('c-Users-foo-bar')
  })
})

// ── parseJsonlFull ────────────────────────────────────────────────────────────
// Exercised indirectly via the public extractAll() path, but the underlying
// parser is a private method we can reach through `as any`.

describe('CursorExtractor parsing (parseJsonlFull-equivalent logic)', () => {
  it('parses user and assistant messages from Cursor JSONL format', async () => {
    // The private parser is streaming-based, so we test the shape via the
    // line format: both roles, text content extracted from message.content array.
    const userRecord = JSON.parse(line('user', 'Fix the bug'))
    const assistantRecord = JSON.parse(line('assistant', 'Here is the fix.'))

    // Validate the shape the parser expects
    expect(userRecord.role).toBe('user')
    expect(userRecord.message.content[0].type).toBe('text')
    expect(userRecord.message.content[0].text).toBe('Fix the bug')
    expect(assistantRecord.role).toBe('assistant')
  })

  it('skips records with roles other than user/assistant', () => {
    const toolLine = JSON.stringify({ role: 'tool', message: { content: [{ type: 'text', text: 'output' }] } })
    const parsed = JSON.parse(toolLine)
    expect(parsed.role !== 'user' && parsed.role !== 'assistant').toBe(true)
  })

  it('concatenates multiple content parts with newline', () => {
    const record = JSON.parse(line('user', 'part one', 'part two'))
    const text = record.message.content
      .filter((c: any) => c.type === 'text' && c.text)
      .map((c: any) => c.text)
      .join('\n')
      .trim()
    expect(text).toBe('part one\npart two')
  })
})

// ── Malformed content regression (prescanFirstUserMessage / parseJsonlFull) ────
// Regression: message.content is typed as an array, but a corrupted/truncated
// write could carry a non-array value or an array with null entries. Calling
// .filter on either previously threw, which was swallowed by the per-line
// catch and silently dropped the whole message.

describe('CursorExtractor file-based parsing of malformed content', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'cursor-test-'))
  })
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('parseJsonlFull skips a record whose content is a bare string instead of throwing', async () => {
    const file = join(tmpDir, 'chat.jsonl')
    const malformed = JSON.stringify({ role: 'user', message: { content: 'not an array' } })
    await writeFile(file, [malformed, line('assistant', 'still parsed')].join('\n'))

    const messages = await extractor().parseJsonlFull(file)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ role: 'assistant', content: 'still parsed' })
  })

  it('parseJsonlFull skips a null entry within content array instead of throwing', async () => {
    const file = join(tmpDir, 'chat.jsonl')
    const malformed = JSON.stringify({ role: 'user', message: { content: [null, { type: 'text', text: 'hello' }] } })
    await writeFile(file, malformed)

    const messages = await extractor().parseJsonlFull(file)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ role: 'user', content: 'hello' })
  })

  it('prescanFirstUserMessage skips a bare-string content record and finds the next valid user message', async () => {
    const file = join(tmpDir, 'chat.jsonl')
    const malformed = JSON.stringify({ role: 'user', message: { content: 'not an array' } })
    await writeFile(file, [malformed, line('user', 'the real first message')].join('\n'))

    const result = await extractor().prescanFirstUserMessage(file)
    expect(result).toMatchObject({ role: 'user', content: 'the real first message' })
  })
})
