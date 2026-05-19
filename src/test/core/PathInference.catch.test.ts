import { vi, describe, it, expect, afterEach } from 'vitest'

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    statSync: vi.fn(actual.statSync),
  }
})

import * as fsMock from 'fs'
import { PathInference } from '../../core/PathInference'

afterEach(() => {
  vi.resetAllMocks()
})

describe('PathInference — filesystem error branches', () => {
  it('catches statSync throwing in findCommonDirectory (line 111)', () => {
    vi.mocked(fsMock.existsSync).mockReturnValue(true)
    vi.mocked(fsMock.statSync as any).mockImplementation(() => {
      throw new Error('permission denied')
    })

    const result = PathInference.inferFromText('/tmp/project/src/main.ts')
    expect(result.reason).toBe('common-parent-from-absolute-paths')
  })

  it('catches existsSync throwing in existsUnder (line 154)', () => {
    vi.mocked(fsMock.existsSync).mockImplementation(() => {
      throw new Error('permission denied')
    })

    const result = PathInference.inferFromText('src/index.ts', {
      candidateWorkspacePath: '/some/project',
    })
    expect(result.confidence).toBe(0)
  })
})
