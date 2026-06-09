import { afterEach, describe, expect, it, vi } from 'vitest'
import { workspace, window } from 'vscode'
import { SkillGenerator } from '../../core/SkillGenerator'

afterEach(() => {
    ;(workspace as any).workspaceFolders = undefined
    ;(workspace as any).getWorkspaceFolder = () => undefined
    window.activeTextEditor = undefined
    window.showQuickPick = async () => undefined
    window.showErrorMessage = () => undefined
})

describe('SkillGenerator.getProjectRoot', () => {
    it('returns undefined when there are no workspace folders', async () => {
        ;(workspace as any).workspaceFolders = undefined
        const root = await SkillGenerator.getProjectRoot()
        expect(root).toBeUndefined()
    })

    it('returns the path of the sole workspace folder when there is only one', async () => {
        ;(workspace as any).workspaceFolders = [{ uri: { fsPath: '/path/to/project1' }, name: 'proj1' }]
        const root = await SkillGenerator.getProjectRoot()
        expect(root).toBe('/path/to/project1')
    })

    it('returns active editor workspace folder when there are multiple and active editor exists', async () => {
        const folder1 = { uri: { fsPath: '/path/to/project1' }, name: 'proj1' }
        const folder2 = { uri: { fsPath: '/path/to/project2' }, name: 'proj2' }
        ;(workspace as any).workspaceFolders = [folder1, folder2]

        window.activeTextEditor = { document: { uri: 'some-uri' } } as any
        ;(workspace as any).getWorkspaceFolder = (uri: any) => {
            if (uri === 'some-uri') { return folder2; }
            return undefined;
        }

        const root = await SkillGenerator.getProjectRoot()
        expect(root).toBe('/path/to/project2')
    })

    it('returns picked workspace from QuickPick when active editor is missing or not in workspace', async () => {
        const folder1 = { uri: { fsPath: '/path/to/project1' }, name: 'proj1' }
        const folder2 = { uri: { fsPath: '/path/to/project2' }, name: 'proj2' }
        ;(workspace as any).workspaceFolders = [folder1, folder2]

        // mock QuickPick choosing folder1
        window.showQuickPick = async (items: any[]) => {
            return items.find(i => i.folder === folder1)
        }

        const root = await SkillGenerator.getProjectRoot()
        expect(root).toBe('/path/to/project1')
    })

    it('returns undefined when user cancels the QuickPick selection', async () => {
        const folder1 = { uri: { fsPath: '/path/to/project1' }, name: 'proj1' }
        const folder2 = { uri: { fsPath: '/path/to/project2' }, name: 'proj2' }
        ;(workspace as any).workspaceFolders = [folder1, folder2]

        window.showQuickPick = async () => undefined

        const root = await SkillGenerator.getProjectRoot()
        expect(root).toBeUndefined()
    })
})

describe('SkillGenerator.generateSkill', () => {
    it('returns no_workspace when there are no workspace folders', async () => {
        ;(workspace as any).workspaceFolders = undefined
        const errorMsgMock = vi.fn()
        window.showErrorMessage = errorMsgMock

        const result = await SkillGenerator.generateSkill()
        expect(result.status).toBe('no_workspace')
        expect(errorMsgMock).toHaveBeenCalled()
    })

    it('returns cancelled when user cancels workspace pick in multi-root', async () => {
        const folder1 = { uri: { fsPath: '/path/to/project1' }, name: 'proj1' }
        const folder2 = { uri: { fsPath: '/path/to/project2' }, name: 'proj2' }
        ;(workspace as any).workspaceFolders = [folder1, folder2]
        window.showQuickPick = async () => undefined

        const errorMsgMock = vi.fn()
        window.showErrorMessage = errorMsgMock

        const result = await SkillGenerator.generateSkill()
        expect(result.status).toBe('cancelled')
        expect((result as any).projectRoot).toBe('')
        expect(errorMsgMock).not.toHaveBeenCalled()
    })
})
