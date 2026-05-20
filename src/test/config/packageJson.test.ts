/**
 * Regression tests for package.json UI configuration.
 *
 * These guard against accidental changes to toolbar buttons, inline actions,
 * and context menus — things that break the UI silently with no TypeScript error.
 */
import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')
)

const viewTitle: Array<{ command: string; when?: string; group?: string }> =
  pkg.contributes.menus['view/title'] ?? []

const viewItemContext: Array<{ command: string; when?: string; group?: string }> =
  pkg.contributes.menus['view/item/context'] ?? []

// ── Toolbar (view/title) ──────────────────────────────────────────────────────

describe('panel toolbar (view/title)', () => {
  it('contains scanAllIdes as the primary action', () => {
    const entry = viewTitle.find(e => e.command === 'edoTensei.scanAllIdes')
    expect(entry).toBeDefined()
    expect(entry?.group).toBe('navigation@1')
  })

  it('does NOT contain exportAllSessions — it was moved to IDE item inline', () => {
    const entry = viewTitle.find(e => e.command === 'edoTensei.exportAllSessions')
    expect(entry).toBeUndefined()
  })

  it('contains openSettings, generateAgentSkill, and showMcpConfig', () => {
    const commands = viewTitle.map(e => e.command)
    expect(commands).toContain('edoTensei.openSettings')
    expect(commands).toContain('edoTensei.generateAgentSkill')
    expect(commands).toContain('edoTensei.showMcpConfig')
  })
})

// ── IDE item inline buttons (ideParentItem) ───────────────────────────────────

describe('ideParentItem inline buttons', () => {
  const ideInline = viewItemContext.filter(
    e => e.when?.includes('ideParentItem') && e.group?.startsWith('inline')
  )

  it('has refreshIde at inline@1', () => {
    const entry = ideInline.find(e => e.command === 'edoTensei.refreshIde' && e.group === 'inline@1')
    expect(entry).toBeDefined()
  })

  it('has exportAllSessions at inline@2', () => {
    const entry = ideInline.find(e => e.command === 'edoTensei.exportAllSessions' && e.group === 'inline@2')
    expect(entry).toBeDefined()
  })

  it('has no other inline buttons on IDE items', () => {
    expect(ideInline).toHaveLength(2)
  })
})

// ── Session item inline buttons (sessionItem) ─────────────────────────────────

describe('sessionItem inline buttons', () => {
  const sessionInline = viewItemContext.filter(
    e => e.when?.includes('sessionItem') && e.group?.startsWith('inline')
  )

  it('has copyHandoffPrompt at inline@1', () => {
    const entry = sessionInline.find(e => e.command === 'edoTensei.copyHandoffPrompt' && e.group === 'inline@1')
    expect(entry).toBeDefined()
  })

  it('has copyRawPath at inline@2', () => {
    const entry = sessionInline.find(e => e.command === 'edoTensei.copyRawPath' && e.group === 'inline@2')
    expect(entry).toBeDefined()
  })

  it('has exportSession at inline@3', () => {
    const entry = sessionInline.find(e => e.command === 'edoTensei.exportSession' && e.group === 'inline@3')
    expect(entry).toBeDefined()
  })
})
