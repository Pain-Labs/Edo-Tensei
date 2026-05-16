import fs from 'fs'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PathInference } from '../../core/PathInference'

async function withTempWorkspace<T>(run: (workspace: string) => Promise<T>): Promise<T> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'edo-tensei-path-inference-'))
  const workspace = path.join(root, 'project')
  await fsp.mkdir(path.join(workspace, 'src'), { recursive: true })
  await fsp.mkdir(path.join(workspace, 'docs'), { recursive: true })
  await fsp.writeFile(path.join(workspace, 'package.json'), '{}')
  await fsp.writeFile(path.join(workspace, 'src', 'index.ts'), 'export {}')
  await fsp.writeFile(path.join(workspace, 'docs', 'guide.md'), '# Guide')

  try {
    return await run(workspace)
  } finally {
    await fsp.rm(root, { recursive: true, force: true })
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PathInference', () => {
  it('extracts unique absolute and relative path mentions while cleaning punctuation and images', () => {
    const mentions = PathInference.extractPathMentions([
      'Open C:\\Workspace\\SampleProject\\src\\index.ts, then C:\\Workspace\\SampleProject\\src\\index.ts.',
      'Also inspect /tmp/sample-project/docs/readme.md and src/core/file.ts.',
      'Ignore docs/logo.png and `scripts/build.ts`.',
    ].join('\n'))

    expect(mentions).toContain('C:\\Workspace\\SampleProject\\src\\index.ts')
    expect(mentions).toContain('/tmp/sample-project/docs/readme.md')
    expect(mentions).toContain('src/core/file.ts')
    expect(mentions).toContain('scripts/build.ts')
    expect(mentions).not.toContain('docs/logo.png')
    expect(new Set(mentions).size).toBe(mentions.length)
  })

  it('uses candidate workspace evidence from absolute and relative mentions', async () => {
    await withTempWorkspace(async workspace => {
      const result = PathInference.inferFromText([
        `Please edit ${path.join(workspace, 'src', 'index.ts')}.`,
        'Also review src/index.ts and docs/guide.md.',
      ].join('\n'), { candidateWorkspacePath: workspace, maxEvidence: 2 })

      expect(result.workspacePath).toBe(path.resolve(workspace))
      expect(result.confidence).toBe(0.85)
      expect(result.reason).toBe('candidate-workspace-path-evidence')
      expect(result.evidence).toHaveLength(2)
    })
  })

  it('falls back to a common parent from absolute paths and trims to a project-like root', async () => {
    await withTempWorkspace(async workspace => {
      const result = PathInference.inferWorkspacePath([
        { role: 'user', content: `Check ${path.join(workspace, 'src', 'index.ts')}` },
        { role: 'assistant', content: `Then inspect ${path.join(workspace, 'docs', 'guide.md')}` },
      ])

      expect(result.workspacePath).toBe(path.resolve(workspace))
      expect(result.confidence).toBe(0.72)
      expect(result.reason).toBe('common-parent-from-absolute-paths')
    })
  })

  it('returns zero-confidence reasons when evidence cannot resolve a workspace', async () => {
    await withTempWorkspace(async workspace => {
      expect(PathInference.inferFromText('No paths here.')).toMatchObject({
        confidence: 0,
        evidence: [],
        reason: 'no-path-mentions',
      })

      expect(PathInference.inferFromText('Mention src/missing.ts only.', { candidateWorkspacePath: workspace })).toMatchObject({
        confidence: 0,
        reason: 'path-mentions-found-but-no-workspace',
      })
    })
  })

  it('handles filesystem failures while deriving common directories and candidate evidence', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'statSync').mockImplementation(() => {
      throw new Error('blocked')
    })

    const result = PathInference.inferFromText('/tmp/sample-project/src/index.ts\n/tmp/sample-project/docs/readme.md')

    expect(result.workspacePath?.replace(/\\/g, '/')).toContain('/tmp/sample-project')
    expect(result.reason).toBe('common-parent-from-absolute-paths')
  })

  it('treats missing candidate-relative evidence as unresolved workspace evidence', async () => {
    await withTempWorkspace(async workspace => {
      expect(PathInference.inferFromText('Please inspect src/missing.ts.', { candidateWorkspacePath: workspace })).toMatchObject({
        confidence: 0,
        reason: 'path-mentions-found-but-no-workspace',
      })
    })
  })
})
