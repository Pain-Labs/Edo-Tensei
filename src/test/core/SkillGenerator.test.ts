import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillGenerator } from '../../core/SkillGenerator'
import { window, workspace } from '../__mocks__/vscode'

let tempRoot: string | undefined

async function makeWorkspace(name: string): Promise<{ name: string; uri: { fsPath: string } }> {
  if (!tempRoot) {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'edo-skill-generator-'))
  }
  const fsPath = path.join(tempRoot, name)
  await fs.mkdir(fsPath, { recursive: true })
  return { name, uri: { fsPath } }
}

afterEach(async () => {
  workspace.workspaceFolders = undefined
  window.showQuickPick = async () => undefined
  window.showErrorMessage = async () => undefined
  vi.restoreAllMocks()

  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true })
    tempRoot = undefined
  }
})

describe('SkillGenerator', () => {
  it('generates skills in the selected workspace instead of the first workspace', async () => {
    const first = await makeWorkspace('first-project')
    const second = await makeWorkspace('second-project')
    workspace.workspaceFolders = [first, second]

    const quickPick = vi.fn(async (items: unknown) => {
      const choices = items as any[]
      if (choices[0]?.projectRoot) {
        return choices[1]
      }
      return [choices[0]]
    })
    window.showQuickPick = quickPick

    const result = await SkillGenerator.generateSkill()

    expect(result.status).toBe('generated')
    if (result.status !== 'generated') return

    expect(result.projectRoot).toBe(second.uri.fsPath)
    expect(result.skillPaths).toEqual([
      path.join(second.uri.fsPath, '.claude', 'skills', 'edo-tensei', 'SKILL.md'),
    ])
    await expect(fs.access(result.skillPaths[0])).resolves.toBeUndefined()
    await expect(fs.access(path.join(first.uri.fsPath, '.claude'))).rejects.toThrow()
    expect(quickPick).toHaveBeenCalledTimes(2)
  })

  it('treats cancelling the workspace picker as a quiet cancellation', async () => {
    const first = await makeWorkspace('first-project')
    const second = await makeWorkspace('second-project')
    workspace.workspaceFolders = [first, second]
    const showError = vi.fn(async () => undefined)

    window.showQuickPick = async () => undefined
    window.showErrorMessage = showError

    const result = await SkillGenerator.generateSkill()

    expect(result).toEqual({ status: 'cancelled', projectRoot: '' })
    expect(showError).not.toHaveBeenCalled()
  })
})
