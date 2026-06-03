import { describe, expect, it } from 'vitest'
import { SessionSearchEngine } from '../../core/SessionSearchEngine'
import { CapturedSession } from '../../core/extractors/types'

function session(overrides: Partial<CapturedSession>): CapturedSession {
  return {
    sourceIde: 'codex',
    capturedAt: '2026-05-16T10:00:00.000Z',
    title: 'Security hardening',
    workspacePath: 'C:\\Work\\Edo-Tensei',
    messages: [
      { role: 'user', content: 'Please fix Codex extractor sanitization.' },
      { role: 'assistant', content: 'Added focused tests.' },
    ],
    rawPath: 'C:\\Work\\Edo-Tensei\\.codex\\rollout.jsonl',
    readStatus: 'success',
    ...overrides,
  }
}

describe('SessionSearchEngine', () => {
  it('returns recency-sorted matches when no text matcher is provided', () => {
    const engine = new SessionSearchEngine()
    const older = session({ sessionId: 'older', capturedAt: '2026-05-15T10:00:00.000Z' })
    const newer = session({ sessionId: 'newer', capturedAt: '2026-05-16T10:00:00.000Z' })

    expect(engine.search([older, newer], {}).map(match => match.session.sessionId)).toEqual(['newer', 'older'])
    expect(engine.search([older, newer], { limit: 1 })).toHaveLength(1)
    expect(engine.search([older, newer], { limit: 0 })).toHaveLength(1)
  })

  it('scores title, workspace, raw path, and message matches', () => {
    const engine = new SessionSearchEngine()
    const results = engine.search([
      session({ sessionId: 'hit' }),
      session({ sessionId: 'miss', title: 'Other topic', messages: [{ role: 'user', content: 'Unrelated' }] }),
    ], { query: 'codex extractor' })

    expect(results).toHaveLength(1)
    expect(results[0].session.sessionId).toBe('hit')
    // 'codex' appears in sourceIde and rawPath; 'extractor' appears in messages → cross-field AND
    expect(results[0].matchedFields).toEqual(['sourceIde', 'rawPath', 'messages'])
    expect(results[0].snippets.some(s => s.includes('Please fix Codex extractor sanitization.'))).toBe(true)
  })

  it('supports regex, invalid regex, IDE, workspace, time, and includeMessages filters', () => {
    const engine = new SessionSearchEngine()
    const sessions = [
      session({ sessionId: 'codex', sourceIde: 'codex', capturedAt: '2026-05-16T10:00:00.000Z' }),
      session({
        sessionId: 'copilot',
        sourceIde: 'copilot',
        capturedAt: '2026-05-14T10:00:00.000Z',
        workspacePath: 'C:\\Other',
        messages: [{ role: 'assistant', content: 'Copilot note' }],
      }),
      session({
        sessionId: 'no-workspace',
        title: 'Unrelated topic',
        workspacePath: undefined,
        messages: [{ role: 'user', content: 'Codex extractor' }],
      }),
    ]

    expect(engine.search(sessions, { regex: 'security|copilot' }).map(match => match.session.sessionId)).toEqual(['codex', 'copilot'])
    expect(engine.search(sessions, { regex: '[' })).toEqual([])
    expect(engine.search(sessions, { ide: 'copilot' }).map(match => match.session.sessionId)).toEqual(['copilot'])
    expect(engine.search(sessions, { query: 'copilot' }).map(match => match.session.sessionId)).toContain('copilot')
    expect(engine.search(sessions, { workspacePath: 'C:\\Work' }).map(match => match.session.sessionId)).toEqual(['codex'])
    expect(engine.search(sessions, { time: '2026-05-16' }).map(match => match.session.sessionId)).toEqual(['codex', 'no-workspace'])
    expect(engine.search(sessions, { query: 'codex extractor', includeMessages: false })).toEqual([])
  })

  it('truncates long message snippets', () => {
    const engine = new SessionSearchEngine()
    // Text is 267 chars total; makeTargetedSnippet uses a 350-char window so
    // the full content fits and no truncation marker is appended.
    const longText = `needle ${'x'.repeat(260)}`
    const [result] = engine.search([session({ messages: [{ role: 'assistant', content: longText }] })], { query: 'needle' })

    expect(result.score).toBe(4)
    expect(result.snippets[0].length).toBeLessThanOrEqual(352) // 350 window + optional leading/trailing …
    expect(result.snippets[0]).toContain('needle')

    // Verify that a text longer than the 350-char window IS truncated with …
    const veryLongText = `needle ${'x'.repeat(400)}`
    const [result2] = engine.search([session({ messages: [{ role: 'assistant', content: veryLongText }] })], { query: 'needle' })
    expect(result2.snippets[0].endsWith('…')).toBe(true)
  })

  it('centers message snippet around the first hit position rather than the start', () => {
    const engine = new SessionSearchEngine()
    // Put the search term 200 chars into the content — snippet must start mid-text
    // (with a leading "…") rather than from position 0.
    const prefix = 'a'.repeat(200)
    const content = `${prefix} needle rest-of-content`
    const [result] = engine.search(
      [session({ messages: [{ role: 'user', content }] })],
      { query: 'needle' }
    )

    expect(result.snippets[0]).toContain('needle')
    expect(result.snippets[0].startsWith('…')).toBe(true) // prefix was trimmed
    expect(result.snippets[0]).not.toContain('a'.repeat(100)) // start of 200-char prefix not included
  })

  it('keeps a single messages field and caps message snippets after metadata snippets', () => {
    const engine = new SessionSearchEngine()
    const [result] = engine.search([
      session({
        title: 'needle title',
        workspacePath: 'C:\\Work\\needle',
        rawPath: 'C:\\Work\\needle\\rollout.jsonl',
        messages: [
          { role: 'user', content: 'needle first user message' },
          { role: 'assistant', content: 'needle assistant message' },
          { role: 'user', content: 'needle second user message' },
        ],
      }),
    ], { query: 'needle' })

    expect(result.matchedFields).toEqual(['title', 'workspacePath', 'rawPath', 'messages'])
    expect(result.snippets).toHaveLength(5)
    expect(result.snippets.filter(snippet => snippet.includes('message'))).toHaveLength(2)
  })
})
