import { vi, describe, it, expect } from 'vitest'

vi.mock('fs/promises')

import * as fsp from 'fs/promises'
import { join } from 'path'
import { WindsurfExtractor } from '../../core/extractors/WindsurfExtractor'

function ext() {
  return new WindsurfExtractor() as any
}

// ── extractPrintableStrings / isHumanText (private helpers) ───────────────────
// These operate on an in-memory Buffer and never touch the filesystem, so no
// mocking is needed for this section.

describe('WindsurfExtractor.extractPrintableStrings', () => {
  it('extracts a printable ASCII run bounded by non-printable bytes', () => {
    const human = 'This is a real conversation message about the bug.'
    const buffer = Buffer.concat([
      Buffer.from([0x00, 0x01, 0x02]),
      Buffer.from(human, 'utf8'),
      Buffer.from([0x00, 0x03]),
    ])
    const strings = ext().extractPrintableStrings(buffer)
    expect(strings).toContain(human)
  })

  it('flushes a trailing printable run that reaches the end of the buffer', () => {
    const human = 'Trailing text with no terminating control byte here'
    const buffer = Buffer.from(human, 'utf8')
    const strings = ext().extractPrintableStrings(buffer)
    expect(strings).toContain(human)
  })

  it('drops runs shorter than 30 bytes', () => {
    const short = 'too short'
    const buffer = Buffer.concat([Buffer.from([0x00]), Buffer.from(short, 'utf8'), Buffer.from([0x00])])
    const strings = ext().extractPrintableStrings(buffer)
    expect(strings).not.toContain(short)
  })

  it('drops a long run of a single repeated character (not human text)', () => {
    const repeated = 'x'.repeat(40)
    const buffer = Buffer.from(repeated, 'utf8')
    const strings = ext().extractPrintableStrings(buffer)
    expect(strings).not.toContain(repeated)
  })

  it('drops runs with no language characters (pure punctuation/digits)', () => {
    const symbols = '0123456789-_=+/*()[]{}!@#$%^&*()0123456789'
    const buffer = Buffer.from(symbols, 'utf8')
    const strings = ext().extractPrintableStrings(buffer)
    expect(strings).not.toContain(symbols)
  })

  it('returns an empty array for an empty buffer', () => {
    expect(ext().extractPrintableStrings(Buffer.alloc(0))).toEqual([])
  })
})

describe('WindsurfExtractor.isHumanText', () => {
  it('accepts a normal sentence', () => {
    expect(ext().isHumanText('The quick brown fox jumps over the lazy dog.')).toBe(true)
  })

  it('accepts CJK text', () => {
    const cjk = '這是一段真實的中文對話內容用來測試可讀性判斷邏輯是否正確運作'
    expect(ext().isHumanText(cjk)).toBe(true)
  })

  it('rejects text below the printable-character ratio threshold', () => {
    // Mostly U+FFFD/U+FFFE filler (not in the printable/CJK/whitespace ranges),
    // alternated to avoid also tripping the repeated-character rule.
    const filler = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? '�' : '￾')).join('')
    const noisy = 'ab' + filler
    expect(ext().isHumanText(noisy)).toBe(false)
  })

  it('rejects text with no language characters at all', () => {
    expect(ext().isHumanText('1234567890 1234567890 1234567890')).toBe(false)
  })

  it('rejects text with 21+ repeated identical characters', () => {
    expect(ext().isHumanText('a'.repeat(130))).toBe(false)
  })
})

// ── extractAll / extract (file-based, via mocked fs/promises) ─────────────────
// fs/promises is fully mocked so these tests never touch the real
// ~/.codeium/windsurf/cascade directory that may exist on a developer machine.

describe('WindsurfExtractor file-based', () => {
  const scanDir = join('C:', 'fake-windsurf-scan')

  function mockDirWithFiles(files: Record<string, Buffer>, mtimes: Record<string, number> = {}) {
    vi.mocked(fsp.access).mockImplementation(async (p: any) => {
      if (p === scanDir) return undefined
      throw new Error('ENOENT');
    })
    vi.mocked(fsp.readdir).mockImplementation(async (p: any) => {
      if (p === scanDir) return Object.keys(files) as any
      throw new Error('ENOENT');
    })
    vi.mocked(fsp.stat).mockImplementation(async (p: any) => {
      const name = String(p).slice(scanDir.length + 1)
      if (files[name] !== undefined) {
        return { mtimeMs: mtimes[name] ?? 1000 } as any
      }
      throw new Error('ENOENT');
    })
    vi.mocked(fsp.readFile).mockImplementation(async (p: any) => {
      const name = String(p).slice(scanDir.length + 1)
      if (files[name] !== undefined) return files[name] as any
      throw new Error('ENOENT');
    })
  }

  it('extracts messages from a .pb file readable as printable strings', async () => {
    const human = 'This is the extracted conversation text from the binary log.'
    mockDirWithFiles({ 'session-1.pb': Buffer.concat([Buffer.from([0x00]), Buffer.from(human, 'utf8')]) })

    const sessions = await ext().extractAll(undefined, [scanDir])

    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ sourceIde: 'windsurf', sessionId: 'session-1', readStatus: 'success' })
    expect(sessions[0].messages).toHaveLength(1)
    expect(sessions[0].messages[0]).toMatchObject({ role: 'assistant', content: human })
  })

  it('ignores non-.pb files in the scan directory', async () => {
    mockDirWithFiles({ 'notes.txt': Buffer.from('This should be ignored regardless of its content length.') })

    const sessions = await ext().extractAll(undefined, [scanDir])
    expect(sessions).toEqual([])
  })

  it('skips a .pb file that yields no extractable messages', async () => {
    mockDirWithFiles({ 'empty.pb': Buffer.from([0x00, 0x41, 0x42, 0x00]) })

    const sessions = await ext().extractAll(undefined, [scanDir])
    expect(sessions).toEqual([])
  })

  it('returns an empty array when the scan directory does not exist', async () => {
    vi.mocked(fsp.access).mockRejectedValue(new Error('ENOENT'))

    const sessions = await ext().extractAll(undefined, [join(scanDir, 'nonexistent')])
    expect(sessions).toEqual([])
  })

  it('sorts sessions by capturedAt descending across multiple files', async () => {
    const older = 'An older conversation message that is long enough.'
    const newer = 'A newer conversation message that is long enough too.'
    mockDirWithFiles(
      { 'old.pb': Buffer.from(older, 'utf8'), 'new.pb': Buffer.from(newer, 'utf8') },
      { 'old.pb': 1000, 'new.pb': 2000 }
    )

    const sessions = await ext().extractAll(undefined, [scanDir])

    expect(sessions).toHaveLength(2)
    expect(sessions[0].sessionId).toBe('new')
    expect(sessions[1].sessionId).toBe('old')
  })

  it('extract() returns the most recent session when files are present', async () => {
    const human = 'A single readable conversation message for extract().'
    mockDirWithFiles({ 'only.pb': Buffer.from(human, 'utf8') })

    const session = await ext().extract(undefined, [scanDir])
    expect(session.sessionId).toBe('only')
    expect(session.messages[0].content).toBe(human)
  })

  it('extract() returns an empty fallback session when nothing is found', async () => {
    vi.mocked(fsp.access).mockRejectedValue(new Error('ENOENT'))

    const session = await ext().extract(undefined, [join(scanDir, 'nonexistent')])
    expect(session.readStatus).toBe('empty')
    expect(session.messages).toEqual([])
  })
})
