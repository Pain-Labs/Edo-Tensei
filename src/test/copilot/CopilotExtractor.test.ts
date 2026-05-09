import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'path'
import { fileURLToPath } from 'url'
import os from 'os'
import fs from 'fs/promises'
import { CopilotExtractor } from '../../core/extractors/CopilotExtractor'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const FIXTURE_ROOT = path.resolve(__dirname, '../../../test/fixtures/copilot')
let fixtureRoot = FIXTURE_ROOT
let fixtureAppData = path.join(fixtureRoot, 'appdata')
let projSessions = path.join(fixtureAppData, 'Code', 'User', 'workspaceStorage', 'ws_edotensei', 'chatSessions')
const PROJ_WORKSPACE = 'C:\\FakeUser\\Projects\\Edo-Tensei'

let originalAppData: string | undefined
let tempFixtureRoot: string | undefined

beforeAll(async () => {
  originalAppData = process.env.APPDATA
  tempFixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'edo-tensei-copilot-fixture-'))
  await fs.cp(FIXTURE_ROOT, tempFixtureRoot, { recursive: true })

  fixtureRoot = tempFixtureRoot
  fixtureAppData = path.join(fixtureRoot, 'appdata')
  projSessions = path.join(fixtureAppData, 'Code', 'User', 'workspaceStorage', 'ws_edotensei', 'chatSessions')

  const workspaceJsonPath = path.join(fixtureAppData, 'Code', 'User', 'workspaceStorage', 'ws_codeworkspace', 'workspace.json')
  const workspaceFilePath = path.join(fixtureRoot, 'EdoTensei.code-workspace')
  await fs.writeFile(workspaceJsonPath, JSON.stringify({ workspace: `file:///${workspaceFilePath.replace(/\\/g, '/')}` }))

  process.env.APPDATA = fixtureAppData
})

afterAll(async () => {
  process.env.APPDATA = originalAppData
  if (tempFixtureRoot) {
    await fs.rm(tempFixtureRoot, { recursive: true, force: true })
  }
})

// ─── prescanJsonl (white-box) ──────────────────────────────────────────────────

describe('prescanJsonl', () => {
  it('v2: kind=0 full snapshot — extracts sessionId and firstMsg', async () => {
    const ext = new CopilotExtractor()
    const results: Array<{ sessionId?: string; firstMsg?: { role: string; content: string } }> =
      await (ext as any).prescanJsonl(path.join(projSessions, 'v2_snapshot.jsonl'))

    expect(results).toHaveLength(1)
    expect(results[0].sessionId).toBe('v2-session')
    expect(results[0].firstMsg?.content).toContain('Edo-Tensei snapshot')
  })

  it('v3: kind=2 k as plain string — extracts sessionId and firstMsg', async () => {
    const ext = new CopilotExtractor()
    const results: Array<{ sessionId?: string; firstMsg?: { role: string; content: string } }> =
      await (ext as any).prescanJsonl(path.join(projSessions, 'v3_k_string.jsonl'))

    expect(results).toHaveLength(1)
    expect(results[0].sessionId).toBe('v3-session')
    expect(results[0].firstMsg?.content).toContain('lazy message loading')
  })

  it('v4: kind=2 k as array ["requests"] — regression test for k=["requests"] bug', async () => {
    const ext = new CopilotExtractor()
    const results: Array<{ sessionId?: string; firstMsg?: { role: string; content: string } }> =
      await (ext as any).prescanJsonl(path.join(projSessions, 'v4_k_array.jsonl'))

    expect(results).toHaveLength(1)
    expect(results[0].sessionId).toBe('v4-session')
    expect(results[0].firstMsg?.content).toContain('array key path')
  })
})

// ─── prescanJson (white-box) ───────────────────────────────────────────────────

describe('prescanJson', () => {
  it('v1: old .json single-file format — extracts sessionId and firstMsg via regex', async () => {
    const ext = new CopilotExtractor()
    const results: Array<{ sessionId?: string; firstMsg?: { role: string; content: string } }> =
      await (ext as any).prescanJson(path.join(projSessions, 'v1_old.json'))

    expect(results).toHaveLength(1)
    expect(results[0].sessionId).toBe('v1-session')
    expect(results[0].firstMsg?.content).toContain('legacy JSON')
  })
})

// ─── loadJsonlFull (white-box) ─────────────────────────────────────────────────

describe('loadJsonlFull', () => {
  it('v2: loads full messages from kind=0 snapshot', async () => {
    const ext = new CopilotExtractor()
    const messages: Array<{ role: string; content: string }> =
      await (ext as any).loadJsonlFull(path.join(projSessions, 'v2_snapshot.jsonl'), 'v2-session')

    expect(messages.length).toBeGreaterThanOrEqual(2)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toContain('Edo-Tensei snapshot')
    expect(messages[1].role).toBe('assistant')
  })

  it('v4: loads full messages after k=["requests"] bug fix', async () => {
    const ext = new CopilotExtractor()
    const messages: Array<{ role: string; content: string }> =
      await (ext as any).loadJsonlFull(path.join(projSessions, 'v4_k_array.jsonl'), 'v4-session')

    expect(messages.length).toBeGreaterThanOrEqual(2)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toContain('array key path')
    expect(messages[1].role).toBe('assistant')
  })
})

// ─── extractAll — scan-all ─────────────────────────────────────────────────────

describe('extractAll — scan-all (no workspace filter)', () => {
  it('returns all sessions from every workspaceStorage entry', async () => {
    const ext = new CopilotExtractor()
    const sessions = await ext.extractAll(undefined)
    const ids = sessions.map(s => s.sessionId)

    expect(ids).toContain('v1-session')
    expect(ids).toContain('v2-session')
    expect(ids).toContain('v3-session')
    expect(ids).toContain('v4-session')
    expect(ids).toContain('codews-session')
    expect(ids).toContain('other-session')
  })

  it('includes v4 session — regression: k=["requests"] bug was invisible in scan-all', async () => {
    const ext = new CopilotExtractor()
    const sessions = await ext.extractAll(undefined)
    const v4 = sessions.find(s => s.sessionId === 'v4-session')

    expect(v4).toBeDefined()
    expect(v4?.messages.length).toBeGreaterThan(0)
  })
})

// ─── extractAll — scan-project ─────────────────────────────────────────────────

describe('extractAll — scan-project (workspace filter)', () => {
  it('includes sessions from the matching folder workspace', async () => {
    const ext = new CopilotExtractor()
    const sessions = await ext.extractAll(PROJ_WORKSPACE)
    const ids = sessions.map(s => s.sessionId)

    expect(ids).toContain('v1-session')
    expect(ids).toContain('v2-session')
    expect(ids).toContain('v3-session')
    expect(ids).toContain('v4-session')
  })

  it('excludes sessions from a different project', async () => {
    const ext = new CopilotExtractor()
    const sessions = await ext.extractAll(PROJ_WORKSPACE)
    const ids = sessions.map(s => s.sessionId)

    expect(ids).not.toContain('other-session')
  })

  it('includes sessions from a .code-workspace that resolves to the target folder', async () => {
    const ext = new CopilotExtractor()
    const sessions = await ext.extractAll(PROJ_WORKSPACE)
    const ids = sessions.map(s => s.sessionId)

    expect(ids).toContain('codews-session')
  })

  it('v4 session is found in scan-project — core regression test', async () => {
    const ext = new CopilotExtractor()
    const sessions = await ext.extractAll(PROJ_WORKSPACE)
    const v4 = sessions.find(s => s.sessionId === 'v4-session')

    expect(v4).toBeDefined()
    expect(v4?.messages[0]?.content).toContain('array key path')
  })
})
