import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFile, mkdir, mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { CodexExtractor } from '../../core/extractors/CodexExtractor'

// Kept separate from CodexExtractor.test.ts, which mocks fs/promises module-wide.

function rolloutJsonl(id: string, text: string): string {
  return [
    JSON.stringify({ type: 'session_meta', payload: { id, cwd: '/tmp/project' } }),
    JSON.stringify({
      type: 'response_item',
      timestamp: '2026-01-01T00:00:00Z',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
    }),
    JSON.stringify({
      type: 'response_item',
      timestamp: '2026-01-01T00:00:01Z',
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Sure, here is the plan.' }] },
    }),
  ].join('\n')
}

describe('CodexExtractor.extractAll scan path de-duplication', () => {
  let tmpDir: string
  let sessionsDir: string

  function extractor(): CodexExtractor {
    const ext = new CodexExtractor()
    ;(ext as any).getSessionsDir = () => sessionsDir
    return ext
  }

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'codex-test-'))
    sessionsDir = join(tmpDir, 'sessions')
    const dayDir = join(sessionsDir, '2026', '01', '01')
    await mkdir(dayDir, { recursive: true })
    await writeFile(join(dayDir, 'rollout-a.jsonl'), rolloutJsonl('session-a', 'Please refactor the session parser module.'))
    await writeFile(join(dayDir, 'rollout-b.jsonl'), rolloutJsonl('session-b', 'Please add coverage for the timeline view.'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('returns each rollout once with no custom scan paths', async () => {
    const sessions = await extractor().extractAll()
    expect(sessions.map(s => s.sessionId).sort()).toEqual(['session-a', 'session-b'])
  })

  it('does not duplicate sessions when a custom path equals the default sessions dir', async () => {
    const sessions = await extractor().extractAll(undefined, [sessionsDir])
    expect(sessions.map(s => s.sessionId).sort()).toEqual(['session-a', 'session-b'])
  })

  it('does not duplicate sessions when a custom path is a parent of the default sessions dir', async () => {
    const sessions = await extractor().extractAll(undefined, [tmpDir])
    expect(sessions.map(s => s.sessionId).sort()).toEqual(['session-a', 'session-b'])
  })

  it('does not duplicate sessions when a custom path is nested inside the default sessions dir', async () => {
    const sessions = await extractor().extractAll(undefined, [join(sessionsDir, '2026', '01'), join(sessionsDir, '2026', '01', '')])
    expect(sessions.map(s => s.sessionId).sort()).toEqual(['session-a', 'session-b'])
  })
})
