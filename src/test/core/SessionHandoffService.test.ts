import { describe, expect, it } from 'vitest'
import { SessionHandoffService } from '../../core/SessionHandoffService'
import { CapturedSession, IChatExtractor } from '../../core/extractors/types'

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function buildSession(sourceIde: CapturedSession['sourceIde']): CapturedSession {
  return {
    sourceIde,
    capturedAt: new Date().toISOString(),
    messages: [{ role: 'user', content: `hello-${sourceIde}` }],
    rawPath: `/tmp/${sourceIde}.jsonl`,
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

    const sessions = await service.scanAllSessions()

    expect(sessions).toHaveLength(4)
    expect(maxActive).toBeLessThanOrEqual(2)
  })
})
