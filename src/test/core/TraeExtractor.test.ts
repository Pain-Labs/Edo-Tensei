import { vi, describe, it, expect } from 'vitest'

vi.mock('fs/promises')

import * as fsp from 'fs/promises'
import * as path from 'path'
import { TraeExtractor } from '../../core/extractors/TraeExtractor'

describe('TraeExtractor', () => {
  it('does not drop a printable string that runs to the end of the .db file', async () => {
    const storageDir = path.join(process.env.APPDATA || '', 'Trae', 'User', 'globalStorage', '.ckg', 'storage')
    const hashDir = path.join(storageDir, 'hash1')
    const dbPath = path.join(hashDir, 'foo_codekg.db')

    vi.mocked(fsp.access).mockResolvedValue(undefined)
    vi.mocked(fsp.readdir).mockImplementation(async (dir: any) => {
      if (dir === storageDir) return ['hash1'] as any
      if (dir === hashDir) return ['foo_codekg.db'] as any
      return [] as any
    })
    vi.mocked(fsp.stat).mockImplementation(async (p: any) => {
      if (p === hashDir) return { isDirectory: () => true } as any
      if (p === dbPath) return { mtimeMs: 1000 } as any
      return { isDirectory: () => false, mtimeMs: 0 } as any
    })

    // A printable, human-looking string (> 50 chars, the extractor's own noise
    // filter) that runs all the way to the end of the buffer, with no trailing
    // non-printable byte to trigger a flush mid-scan.
    const trailingText = 'a'.repeat(60)
    vi.mocked(fsp.readFile).mockResolvedValue(Buffer.from(trailingText, 'utf8') as any)

    const ext = new TraeExtractor()
    const result = await ext.extract()

    expect(result.readStatus).toBe('success')
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].content).toBe(trailingText)
  })
})
