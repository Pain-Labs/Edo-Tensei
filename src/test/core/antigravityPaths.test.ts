import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import * as fsPromises from 'fs/promises'

// Mock fs/promises.readdir，僅影響此測試檔
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises')
  return {
    ...actual,
    readdir: vi.fn(),
  }
})

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    readdirSync: vi.fn(),
  }
})

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.mocked(fsPromises.readdir).mockRejectedValue(new Error('Not mocked'))
  vi.mocked(fs.readdirSync).mockImplementation(() => { throw new Error('Not mocked') })
})

describe('getAntigravityBrainDirs', () => {
  it('detects multiple antigravity directories under .gemini', async () => {
    vi.mocked(fsPromises.readdir).mockResolvedValue([
      { isDirectory: () => true, name: 'antigravity' },
      { isDirectory: () => true, name: 'antigravity-ide' },
      { isDirectory: () => true, name: 'antigravity-backup' },
      { isDirectory: () => true, name: 'other-folder' },
      { isDirectory: () => false, name: 'file-not-dir' },
    ] as any)

    const { getAntigravityBrainDirs } = await import('../../core/extractors/antigravityPaths')
    const dirs = await getAntigravityBrainDirs()

    expect(dirs).toHaveLength(3)
    expect(dirs[0]).toContain(path.join('antigravity', 'brain'))
    expect(dirs[1]).toContain(path.join('antigravity-ide', 'brain'))
    expect(dirs[2]).toContain(path.join('antigravity-backup', 'brain'))
    // 確認不包含非 antigravity 目錄
    expect(dirs.some(d => d.includes('other-folder'))).toBe(false)
  })

  it('falls back to default directory on error', async () => {
    vi.mocked(fsPromises.readdir).mockRejectedValue(new Error('readdir failed'))

    const { getAntigravityBrainDirs } = await import('../../core/extractors/antigravityPaths')
    const dirs = await getAntigravityBrainDirs()

    expect(dirs).toHaveLength(1)
    expect(dirs[0]).toContain(path.join('.gemini', 'antigravity', 'brain'))
  })

  it('falls back to default when no antigravity dirs exist', async () => {
    vi.mocked(fsPromises.readdir).mockResolvedValue([
      { isDirectory: () => true, name: 'some-other-tool' },
      { isDirectory: () => false, name: 'random-file' },
    ] as any)

    const { getAntigravityBrainDirs } = await import('../../core/extractors/antigravityPaths')
    const dirs = await getAntigravityBrainDirs()

    expect(dirs).toHaveLength(1)
    expect(dirs[0]).toContain(path.join('.gemini', 'antigravity', 'brain'))
  })
})

describe('getAntigravityBrainDirsSync', () => {
  it('detects multiple antigravity directories under .gemini (sync)', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue([
      { isDirectory: () => true, name: 'antigravity' },
      { isDirectory: () => true, name: 'antigravity-ide' },
      { isDirectory: () => true, name: 'other-folder' },
      { isDirectory: () => false, name: 'file-not-dir' },
    ] as any)

    const { getAntigravityBrainDirsSync } = await import('../../core/extractors/antigravityPaths')
    const dirs = getAntigravityBrainDirsSync()

    expect(dirs).toHaveLength(2)
    expect(dirs[0]).toContain(path.join('antigravity', 'brain'))
    expect(dirs[1]).toContain(path.join('antigravity-ide', 'brain'))
    expect(dirs.some(d => d.includes('other-folder'))).toBe(false)
  })

  it('falls back to default directory on error (sync)', async () => {
    vi.mocked(fs.readdirSync).mockImplementation(() => { throw new Error('readdirSync failed') })

    const { getAntigravityBrainDirsSync } = await import('../../core/extractors/antigravityPaths')
    const dirs = getAntigravityBrainDirsSync()

    expect(dirs).toHaveLength(1)
    expect(dirs[0]).toContain(path.join('.gemini', 'antigravity', 'brain'))
  })

  it('falls back to default when no antigravity dirs exist (sync)', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue([
      { isDirectory: () => true, name: 'some-other-tool' },
    ] as any)

    const { getAntigravityBrainDirsSync } = await import('../../core/extractors/antigravityPaths')
    const dirs = getAntigravityBrainDirsSync()

    expect(dirs).toHaveLength(1)
    expect(dirs[0]).toContain(path.join('.gemini', 'antigravity', 'brain'))
  })
})
