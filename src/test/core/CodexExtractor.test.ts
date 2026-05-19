import { vi, describe, it, expect } from 'vitest'

vi.mock('fs/promises')

import * as fsp from 'fs/promises'
import { CodexExtractor } from '../../core/extractors/CodexExtractor'

describe('CodexExtractor', () => {
  it('returns an empty codex session when no sessions directory exists', async () => {
    vi.mocked(fsp.access).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const ext = new CodexExtractor()
    const result = await ext.extract()

    expect(result.sourceIde).toBe('codex')
    expect(result.messages).toEqual([])
    expect(result.readStatus).toBe('empty')
  })
})
