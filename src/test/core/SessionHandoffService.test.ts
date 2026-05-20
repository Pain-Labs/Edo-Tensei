import { describe, expect, it } from 'vitest'
import { SessionHandoffService } from '../../core/SessionHandoffService'
import { CapturedSession, IChatExtractor } from '../../core/extractors/types'
import * as path from 'path'

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function buildSession(sourceIde: CapturedSession['sourceIde'], index = 0): CapturedSession {
  return {
    sourceIde,
    capturedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    sessionId: `${sourceIde}-${index}`,
    messages: [{ role: 'user', content: `hello-${sourceIde}-${index}` }],
    rawPath: `/tmp/${sourceIde}-${index}.jsonl`,
    readStatus: 'success',
  }
}

describe('SessionHandoffService', () => {
  it('limits concurrent extractor scans to avoid IO saturation', async () => {
    const service = new SessionHandoffService({} as any)

    let active = 0
    let maxActive = 0

    const makeExtractor = (ideId: CapturedSession['sourceIde']): IChatExtractor => ({
      ideId,
      extract: async () => buildSession(ideId),
      extractAll: async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await wait(30)
        active -= 1
        return [buildSession(ideId)]
      },
    })

    ;(service as any).extractors = [
      makeExtractor('copilot'),
      makeExtractor('cursor'),
      makeExtractor('antigravity'),
      makeExtractor('kiro'),
    ]

    const sessions = await service.scanAllIdes()

    expect(sessions).toHaveLength(4)
    expect(maxActive).toBeLessThanOrEqual(2)
  })

  it('does not apply load-more pagination to extractors that do not support it', async () => {
    const service = new SessionHandoffService({} as any)
    const allSessions = Array.from({ length: 305 }, (_, i) => buildSession('cursor', i))

    ;(service as any).extractors = [{
      ideId: 'cursor',
      extract: async () => allSessions[0],
      extractAll: async () => allSessions,
    } satisfies IChatExtractor]

    const sessions = await service.scanSingleIde('cursor')

    expect(sessions).toHaveLength(305)
    expect(service.hasPendingSessions('cursor')).toBe(false)
  })

  it('loads paged extractors one page at a time without duplicating sessions', async () => {
    const service = new SessionHandoffService({} as any)
    const allSessions = Array.from({ length: 305 }, (_, i) => buildSession('copilot', i)).reverse()
    const calls: Array<{ limit?: number; offset?: number }> = []

    ;(service as any).extractors = [{
      ideId: 'copilot',
      supportsPagedExtraction: true,
      extract: async () => allSessions[0],
      extractAll: async (_workspacePath?: string, _customScanPaths?: string[], options?: { limit?: number; offset?: number }) => {
        calls.push({ limit: options?.limit, offset: options?.offset })
        const offset = options?.offset ?? 0
        const limit = options?.limit ?? allSessions.length
        return allSessions.slice(offset, offset + limit)
      },
    } satisfies IChatExtractor]

    const firstPage = await service.scanSingleIde('copilot')
    await service.loadMoreSessions('copilot')
    const loaded = service.getGroupedSessions().get('copilot') ?? []

    expect(firstPage).toHaveLength(300)
    expect(loaded).toHaveLength(305)
    expect(new Set(loaded.map(s => s.rawPath)).size).toBe(305)
    expect(calls).toEqual([
      { limit: 301, offset: 0 },
      { limit: 301, offset: 300 },
    ])
    expect(service.hasPendingSessions('copilot')).toBe(false)
  })
})

describe('SessionHandoffService.buildReadableTranscript', () => {
  it('puts workspace path on the second line when workspacePath is set', () => {
    const service = new SessionHandoffService({} as any)
    const s = buildSession('claude')
    s.workspacePath = 'C:\\Users\\kwz50\\Edo-Tensei'

    const lines = service.buildReadableTranscript(s).split('\n')

    expect(lines[0]).toMatch(/^# Claude/)
    expect(lines[0]).toContain(path.basename(s.workspacePath))
    expect(lines[1]).toBe(s.workspacePath)
  })

  it('omits the workspace path line when workspacePath is absent', () => {
    const service = new SessionHandoffService({} as any)
    const s = buildSession('claude')

    const lines = service.buildReadableTranscript(s).split('\n')

    expect(lines[0]).toBe('# Claude')
    // Second line is the messages header (I18n key fallback), not a filesystem path
    expect(lines[1]).not.toMatch(/^[A-Z]:\\/)
    expect(lines[1]).not.toMatch(/^\/[a-z]/)
  })

  it('capitalises the IDE name in the header', () => {
    const service = new SessionHandoffService({} as any)
    const transcript = service.buildReadableTranscript(buildSession('copilot'))
    expect(transcript).toMatch(/^# Copilot/)
  })
})
