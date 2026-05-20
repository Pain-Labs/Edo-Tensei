import { describe, expect, it } from 'vitest'
import { AntigravityExtractor } from '../../core/extractors/AntigravityExtractor'

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
