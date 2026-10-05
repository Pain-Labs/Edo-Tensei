import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFile, mkdir, mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { CursorExtractor } from '../../core/extractors/CursorExtractor'

function transcriptJsonl(text: string): string {
  return [
    JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text }] } }),
    JSON.stringify({ role: 'assistant', message: { content: [{ type: 'text', text: 'Sure, here is the plan for that change.' }] } }),
  ].join('\n')
}

describe('CursorExtractor.extractAll scan path de-duplication', () => {
  let tmpDir: string
  let projectsDir: string

  function extractor(): CursorExtractor {
    const ext = new CursorExtractor()
    ;(ext as any).getProjectsDir = () => projectsDir
    return ext
  }

  async function writeTranscript(project: string, uuid: string, text: string): Promise<void> {
    const dir = join(projectsDir, project, 'agent-transcripts', uuid)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${uuid}.jsonl`), transcriptJsonl(text))
  }

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'cursor-scan-test-'))
    projectsDir = join(tmpDir, 'projects')
    await writeTranscript('c-Users-dev-alpha', 'uuid-a', 'Please refactor the session parser module.')
    await writeTranscript('c-Users-dev-beta', 'uuid-b', 'Please add coverage for the timeline view.')
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('returns each transcript once with no custom scan paths', async () => {
    const sessions = await extractor().extractAll()
    expect(sessions.map(s => s.sessionId).sort()).toEqual(['uuid-a', 'uuid-b'])
  })

  it('does not duplicate sessions when a custom path equals the default projects dir', async () => {
    const sessions = await extractor().extractAll(undefined, [projectsDir, join(projectsDir, '')])
    expect(sessions.map(s => s.sessionId).sort()).toEqual(['uuid-a', 'uuid-b'])
  })

  it('does not let duplicates consume pagination slots', async () => {
    const page = await extractor().extractAll(undefined, [projectsDir], { limit: 2, offset: 0 })
    expect(page.map(s => s.sessionId).sort()).toEqual(['uuid-a', 'uuid-b'])
    const next = await extractor().extractAll(undefined, [projectsDir], { limit: 2, offset: 2 })
    expect(next).toEqual([])
  })
})
