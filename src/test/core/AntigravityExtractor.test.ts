import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AntigravityExtractor } from '../../core/extractors/AntigravityExtractor'
import * as fs from 'fs/promises'
import * as path from 'path'

// Mock fs/promises
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises')
  return {
    ...actual,
    access: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    readFile: vi.fn(),
  }
})

// Mock antigravityPaths 模組以避免實際掃描 ~/.gemini
vi.mock('../../core/extractors/antigravityPaths', () => {
  return {
    getAntigravityBrainDirs: vi.fn().mockResolvedValue(['/fake/brain']),
  }
})

function makeExtractor() {
  return new AntigravityExtractor() as any
}

// Raw overview.txt line builder helpers
function userLine(content: string, type = 'USER_INPUT'): string {
  return JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type, status: 'DONE', created_at: '2026-05-19T06:00:00Z', content })
}

function modelLine(content: string): string {
  return JSON.stringify({ step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-05-19T06:00:01Z', content })
}

describe('AntigravityExtractor.parseOverview', () => {
  it('strips <USER_REQUEST> wrapper and returns the inner text as content', () => {
    const raw = userLine('<USER_REQUEST>\n執行F5為何沒看到擴充套件?\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nsome system metadata\n</ADDITIONAL_METADATA>')
    const { messages } = makeExtractor().parseOverview(raw)
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe('執行F5為何沒看到擴充套件?')
    expect(messages[0].content).not.toContain('USER_REQUEST')
    expect(messages[0].content).not.toContain('ADDITIONAL_METADATA')
  })

  it('preserves content as-is when no <USER_REQUEST> wrapper is present', () => {
    const raw = userLine('好，請依序處理', 'RUN_COMMAND')
    const { messages } = makeExtractor().parseOverview(raw)
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe('好，請依序處理')
  })

  it('detects truncation marker even after stripping USER_REQUEST wrapper', () => {
    const raw = userLine('<USER_REQUEST>\nsome long message <truncated 883 bytes>\n</USER_REQUEST>')
    const { messages, hasTruncation } = makeExtractor().parseOverview(raw)
    expect(hasTruncation).toBe(true)
    expect(messages[0].content).toContain('<truncated 883 bytes>')
  })

  it('extracts model assistant message', () => {
    const raw = modelLine('讓我查看目前各個 extractor 的狀態')
    const { messages } = makeExtractor().parseOverview(raw)
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('assistant')
    expect(messages[0].content).toBe('讓我查看目前各個 extractor 的狀態')
  })

  it('returns empty messages for malformed or non-conversation lines', () => {
    const raw = JSON.stringify({ step_index: 0, source: 'SYSTEM', type: 'CONFIG' })
    const { messages } = makeExtractor().parseOverview(raw)
    expect(messages).toHaveLength(0)
  })
})

describe('AntigravityExtractor.extractAll', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('scans and parses transcript.jsonl when it exists', async () => {
    // 模擬目錄結構
    vi.mocked(fs.access).mockResolvedValue(undefined)
    vi.mocked(fs.readdir).mockResolvedValue(['session1'] as any)

    // 模擬 stat 成功 (transcript.jsonl 存在)
    vi.mocked(fs.stat).mockImplementation(async (filePath: any) => {
      if (filePath.endsWith('transcript.jsonl')) {
        return { mtimeMs: 1000, size: 100 } as any
      }
      throw new Error('Not transcript')
    })

    // 模擬讀取 transcript.jsonl
    vi.mocked(fs.readFile).mockImplementation(async (filePath: any) => {
      if (filePath.endsWith('transcript.jsonl')) {
        return userLine('from transcript')
      }
      throw new Error('Wrong path')
    })

    const sessions = await makeExtractor().extractAll()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].messages[0].content).toBe('from transcript')
    expect(sessions[0].rawPath).toContain('transcript.jsonl')
  })

  it('falls back to overview.txt when transcript.jsonl does not exist', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined)
    vi.mocked(fs.readdir).mockResolvedValue(['session1'] as any)

    // 模擬 transcript.jsonl 不存在，而 overview.txt 存在
    vi.mocked(fs.stat).mockImplementation(async (filePath: any) => {
      if (filePath.endsWith('overview.txt')) {
        return { mtimeMs: 2000, size: 200 } as any
      }
      throw new Error('Not found')
    })

    // 模擬讀取 overview.txt
    vi.mocked(fs.readFile).mockImplementation(async (filePath: any) => {
      if (filePath.endsWith('overview.txt')) {
        return userLine('from overview')
      }
      throw new Error('Wrong path')
    })

    const sessions = await makeExtractor().extractAll()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].messages[0].content).toBe('from overview')
    expect(sessions[0].rawPath).toContain('overview.txt')
  })

  it('returns empty array when neither log file exists', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined)
    vi.mocked(fs.readdir).mockResolvedValue(['session1'] as any)
    vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'))

    const sessions = await makeExtractor().extractAll()
    expect(sessions).toHaveLength(0)
  })
})
