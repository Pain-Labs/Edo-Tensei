import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const repoRoot = path.resolve(__dirname, '../../..')
const pluginPath = path.join(repoRoot, 'plugin.json')
const skillRoot = path.join(repoRoot, 'skills', 'edo-tensei')
const skillPath = path.join(skillRoot, 'SKILL.md')
const testingGuidePath = path.join(repoRoot, 'docs', 'AGENT_PLUGIN_TESTING.md')
const windsurfReferencePath = path.join(skillRoot, 'session-windsurf.md')

const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf8'))
const skill = fs.readFileSync(skillPath, 'utf8')
const testingGuide = fs.readFileSync(testingGuidePath, 'utf8')
const windsurfReference = fs.readFileSync(windsurfReferencePath, 'utf8')

describe('Agent Plugins 1.0 Skill-only package', () => {
  it('uses the canonical manifest schema and release identity', () => {
    const extensionPackage = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
    )

    expect(plugin.$schema).toBe(
      'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
    )
    expect(plugin.name).toBe('edo-tensei')
    expect(plugin.version).toBe(extensionPackage.version)
    expect(plugin.repository).toBe('https://github.com/Pain-Labs/Edo-Tensei')
  })

  it('contains only portable Agent Plugins 1.0 manifest fields', () => {
    const allowedFields = new Set([
      '$schema',
      'name',
      'version',
      'description',
      'author',
      'homepage',
      'repository',
      'license',
      'keywords',
      'extensions'
    ])

    expect(Object.keys(plugin).filter(key => !allowedFields.has(key))).toEqual([])
  })

  it('does not advertise the deferred MCP enhancement', () => {
    expect(fs.existsSync(path.join(repoRoot, 'mcp.json'))).toBe(false)
  })

  it('ships every local Markdown reference used by the skill', () => {
    const references = [...skill.matchAll(/\[[^\]]+\]\(([^)]+\.md)\)/g)]
      .map(match => match[1])
      .filter(reference => !reference.includes('://'))

    expect(references.length).toBeGreaterThan(0)
    for (const reference of references) {
      expect(
        fs.existsSync(path.resolve(skillRoot, reference)),
        `Missing skill reference: ${reference}`
      ).toBe(true)
    }
  })

  it('declares Windows-only support and deterministic stop rules', () => {
    expect(skill).toContain('**Public support scope:** Windows only.')
    expect(skill).toContain('search only that IDE')
    expect(skill).toContain('normalized absolute path')
    expect(skill).toContain('Do not guess.')
    expect(skill).toContain('blocked by permissions')
  })

  it('uses Git common directory only after exact workspace matching fails', () => {
    expect(skill).toContain('Exact normalized absolute path matches always win')
    expect(skill).toContain(
      'git -C $workspacePath rev-parse --path-format=absolute --git-common-dir'
    )
    expect(skill).toContain('never use a remote URL alone as repository identity')
    expect(skill).toContain('Do not guess based on modification time.')
    expect(testingGuide).toContain('### E. Git linked worktree repository fallback')
  })

  it('documents both Windows Windsurf session locations', () => {
    expect(windsurfReference).toContain(
      '%APPDATA%\\Windsurf\\User\\globalStorage\\chatSessions\\'
    )
    expect(windsurfReference).toContain(
      '%USERPROFILE%\\.codeium\\windsurf\\cascade\\*.pb'
    )
    expect(windsurfReference).toContain('resolved absolute path (`FullName`)')
  })
})
