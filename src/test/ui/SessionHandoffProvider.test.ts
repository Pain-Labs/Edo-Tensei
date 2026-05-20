import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarkdownString, workspace } from 'vscode'
import {
  IDEParentItem,
  LoadingItem,
  LoadMoreItem,
  SessionHandoffProvider,
  SessionItem,
} from '../../ui/SessionHandoffProvider'
import { CapturedSession } from '../../core/extractors/types'

// ── Fixtures ─────────────────────────────────────────────────────────────────

function session(overrides: Partial<CapturedSession> = {}): CapturedSession {
  return {
    sourceIde: 'claude',
    capturedAt: '2026-05-19T06:32:00.000Z',
    title: 'Fix auth bug',
    workspacePath: 'C:\\Users\\kwz50\\Edo-Tensei',
    messages: [
      { role: 'user', content: 'Fix the auth bug in the login flow' },
      { role: 'assistant', content: 'Here is the fix.' },
    ],
    rawPath: 'C:\\Users\\kwz50\\AppData\\Roaming\\Claude\\bee072e1.jsonl',
    readStatus: 'success',
    messagesLoaded: true,
    ...overrides,
  }
}

function makeService(overrides: Record<string, unknown> = {}) {
  return {
    getKnownIdeIds: () => ['claude', 'copilot'] as CapturedSession['sourceIde'][],
    getIdeScanStatus: () =>
      new Map<CapturedSession['sourceIde'], { state: 'idle' | 'scanning' | 'done' | 'error'; found: number }>(),
    getGroupedSessions: () => new Map<CapturedSession['sourceIde'], CapturedSession[]>(),
    isIdeScanned: () => false,
    hasPendingSessions: () => false,
    scanSingleIde: vi.fn().mockResolvedValue([]),
    ensureSessionMessagesLoaded: vi.fn().mockResolvedValue(undefined),
    onDidUpdateSessions: (_: () => void) => ({ dispose: () => undefined }),
    ...overrides,
  } as any
}

afterEach(() => {
  ;(workspace as any).workspaceFolders = undefined
})

// ── SessionItem tooltip ───────────────────────────────────────────────────────

describe('SessionItem tooltip', () => {
  it('is a MarkdownString', () => {
    const item = new SessionItem(session(), true)
    expect(item.tooltip).toBeInstanceOf(MarkdownString)
  })

  it('contains bold title as first line', () => {
    const item = new SessionItem(session(), true)
    const value = (item.tooltip as MarkdownString).value
    expect(value).toMatch(/\*\*Fix auth bug\*\*/)
  })

  it('includes project name and full workspace path', () => {
    const item = new SessionItem(session(), true)
    const value = (item.tooltip as MarkdownString).value
    expect(value).toContain('Edo-Tensei')
    expect(value).toContain('C:\\Users\\kwz50\\Edo-Tensei')
  })

  it('omits project and path lines when workspacePath is absent', () => {
    const item = new SessionItem(session({ workspacePath: undefined }), true)
    const value = (item.tooltip as MarkdownString).value
    expect(value).not.toContain('**專案**')
    expect(value).not.toContain('**路徑**')
  })

  it('shows exact message count without est. suffix for loaded session', () => {
    const item = new SessionItem(session({ messagesLoaded: true }), true)
    const value = (item.tooltip as MarkdownString).value
    expect(value).toContain('2 則')
    expect(value).not.toContain('est.')
  })

  it('shows "—" msgCount and est. suffix for lazy unloaded session with no messages', () => {
    const s = session({ messagesLoaded: false, fileSizeBytes: 50_000, messages: [] })
    const item = new SessionItem(s, true)
    const value = (item.tooltip as MarkdownString).value
    expect(value).toContain('est.')
    expect(value).toContain('— 則')
  })

  it('shows N+ msgCount for lazy session that has partial messages', () => {
    const s = session({ messagesLoaded: false, messages: [{ role: 'user', content: 'hi' }] })
    const item = new SessionItem(s, true)
    const value = (item.tooltip as MarkdownString).value
    expect(value).toContain('1+')
  })

  it('uses home icon for current-workspace session', () => {
    const item = new SessionItem(session(), true, true)
    expect((item.iconPath as any).id).toBe('home')
  })

  it('uses comment-discussion icon for non-workspace session', () => {
    const item = new SessionItem(session(), true, false)
    expect((item.iconPath as any).id).toBe('comment-discussion')
  })

  it('includes project name in description when showProject is true', () => {
    const item = new SessionItem(session(), true)
    expect(item.description).toContain('Edo-Tensei')
  })

  it('shows only timeLabel in description when showProject is false', () => {
    const item = new SessionItem(session(), false)
    expect(item.description).not.toContain('Edo-Tensei')
  })
})

// ── resolveTreeItem ───────────────────────────────────────────────────────────

describe('SessionHandoffProvider.resolveTreeItem', () => {
  it('updates tooltip to exact count after messages are loaded', async () => {
    const service = makeService()
    service.ensureSessionMessagesLoaded.mockImplementation(async (s: CapturedSession) => {
      s.messages = [
        { role: 'user', content: 'Fix the auth bug' },
        { role: 'assistant', content: 'Fixed.' },
      ]
      s.messagesLoaded = true
    })

    const provider = new SessionHandoffProvider(service)
    const s = session({ messagesLoaded: false, fileSizeBytes: 50_000, messages: [] })
    const item = new SessionItem(s, true)

    const resolved = await provider.resolveTreeItem(item, item)
    const value = (resolved.tooltip as MarkdownString).value
    expect(value).toContain('2 則')
    expect(value).not.toContain('est.')
  })

  it('returns item unchanged when element is not a SessionItem', async () => {
    const provider = new SessionHandoffProvider(makeService())
    const ideItem = new IDEParentItem('Claude', 'claude', 0)
    const result = await provider.resolveTreeItem(ideItem, ideItem)
    expect(result).toBe(ideItem)
  })
})

// ── getChildren ───────────────────────────────────────────────────────────────

describe('SessionHandoffProvider.getChildren', () => {
  it('returns an IDEParentItem per known IDE at root level', async () => {
    const provider = new SessionHandoffProvider(makeService())
    const children = await provider.getChildren()
    expect(children).toHaveLength(2)
    expect(children[0]).toBeInstanceOf(IDEParentItem)
    expect((children[0] as IDEParentItem).ideId).toBe('claude')
    expect((children[1] as IDEParentItem).ideId).toBe('copilot')
  })

  it('shows "—" description for unscanned IDE', async () => {
    const provider = new SessionHandoffProvider(makeService({ isIdeScanned: () => false }))
    const children = await provider.getChildren()
    expect((children[0] as IDEParentItem).description).toBe('—')
  })

  it('shows "Scanning…" description while IDE is scanning', async () => {
    const scanStatus = new Map([['claude', { state: 'scanning' as const, found: 0 }]])
    const provider = new SessionHandoffProvider(makeService({ getIdeScanStatus: () => scanStatus }))
    const children = await provider.getChildren()
    expect((children[0] as IDEParentItem).description).toBe('Scanning…')
  })

  it('returns LoadingItem and triggers scanSingleIde on first expand of unscanned IDE', async () => {
    const service = makeService({ isIdeScanned: () => false })
    const provider = new SessionHandoffProvider(service)
    const ideItem = new IDEParentItem('Claude', 'claude', 0)

    const children = await provider.getChildren(ideItem)

    expect(children).toHaveLength(1)
    expect(children[0]).toBeInstanceOf(LoadingItem)
    expect(service.scanSingleIde).toHaveBeenCalledWith('claude')
  })

  it('returns LoadingItem without triggering scan while IDE is already scanning', async () => {
    const scanStatus = new Map([['claude', { state: 'scanning' as const, found: 0 }]])
    const service = makeService({ getIdeScanStatus: () => scanStatus, isIdeScanned: () => false })
    const provider = new SessionHandoffProvider(service)
    const ideItem = new IDEParentItem('Claude', 'claude', 0)

    const children = await provider.getChildren(ideItem)

    expect(children).toHaveLength(1)
    expect(children[0]).toBeInstanceOf(LoadingItem)
    expect(service.scanSingleIde).not.toHaveBeenCalled()
  })

  it('returns SessionItems after IDE is scanned', async () => {
    const sessions = [session(), session({ title: 'Refactor scan' })]
    const grouped = new Map([['claude', sessions]])
    const service = makeService({ isIdeScanned: () => true, getGroupedSessions: () => grouped })
    const provider = new SessionHandoffProvider(service)
    const ideItem = new IDEParentItem('Claude', 'claude', 2)

    const children = await provider.getChildren(ideItem)

    expect(children).toHaveLength(2)
    expect(children[0]).toBeInstanceOf(SessionItem)
  })

  it('marks session with home icon when workspacePath matches open workspace folder', async () => {
    ;(workspace as any).workspaceFolders = [{ uri: { fsPath: 'C:\\Users\\kwz50\\Edo-Tensei' } }]
    const s = session({ workspacePath: 'C:\\Users\\kwz50\\Edo-Tensei' })
    const grouped = new Map([['claude', [s]]])
    const service = makeService({ isIdeScanned: () => true, getGroupedSessions: () => grouped })
    const provider = new SessionHandoffProvider(service)
    const ideItem = new IDEParentItem('Claude', 'claude', 1)

    const children = await provider.getChildren(ideItem)

    expect((children[0] as SessionItem).iconPath).toMatchObject({ id: 'home' })
  })

  it('uses comment-discussion icon when workspacePath does not match', async () => {
    ;(workspace as any).workspaceFolders = [{ uri: { fsPath: 'C:\\Other\\Project' } }]
    const s = session({ workspacePath: 'C:\\Users\\kwz50\\Edo-Tensei' })
    const grouped = new Map([['claude', [s]]])
    const service = makeService({ isIdeScanned: () => true, getGroupedSessions: () => grouped })
    const provider = new SessionHandoffProvider(service)
    const ideItem = new IDEParentItem('Claude', 'claude', 1)

    const children = await provider.getChildren(ideItem)

    expect((children[0] as SessionItem).iconPath).toMatchObject({ id: 'comment-discussion' })
  })

  it('appends LoadMoreItem when IDE has pending sessions', async () => {
    const sessions = [session()]
    const grouped = new Map([['claude', sessions]])
    const service = makeService({
      isIdeScanned: () => true,
      getGroupedSessions: () => grouped,
      hasPendingSessions: () => true,
    })
    const provider = new SessionHandoffProvider(service)
    const ideItem = new IDEParentItem('Claude', 'claude', 1)

    const children = await provider.getChildren(ideItem)
    const last = children[children.length - 1]

    expect(last).toBeInstanceOf(LoadMoreItem)
    expect((last as LoadMoreItem).ideId).toBe('claude')
  })
})
