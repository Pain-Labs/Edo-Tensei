import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { I18n } from '../i18n';

type SkillTarget =
    | '.claude'
    | '.github'
    | '.kiro'
    | '.agents'
    | '.cline'
    | '.gemini';

export type SkillGenerationResult =
    | { status: 'generated'; target: string; projectRoot: string; skillPaths: string[] }
    | { status: 'auto'; projectRoot: string }
    | { status: 'cancelled'; projectRoot: string }
    | { status: 'no_workspace' };

export class SkillGenerator {
    public static async getProjectRoot(): Promise<string | undefined> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return undefined;
        }
        if (workspaceFolders.length === 1) {
            return workspaceFolders[0].uri.fsPath;
        }

        const options = workspaceFolders.map(folder => ({
            label: folder.name || path.basename(folder.uri.fsPath),
            description: folder.uri.fsPath,
            projectRoot: folder.uri.fsPath,
        }));

        const picked = await vscode.window.showQuickPick(options, {
            placeHolder: I18n.getMessage('skill.pickWorkspace'),
        });
        return picked?.projectRoot;
    }

    private static getSkillsSourceDir(): string {
        const bundledPath = path.join(__dirname, '..', 'skills', 'edo-tensei');
        if (fs.existsSync(path.join(bundledPath, 'SKILL.md'))) {
            return bundledPath;
        }

        return path.join(__dirname, '..', '..', 'skills', 'edo-tensei');
    }

    private static readSkillMarkdown(): string {
        const skillPath = path.join(this.getSkillsSourceDir(), 'SKILL.md');
        return fs.readFileSync(skillPath, 'utf8');
    }

    // Copies all session-*.md files from the bundled skills dir to the target skill dir.
    private static copySessionDocs(targetDir: string): void {
        const sourceDir = this.getSkillsSourceDir();
        try {
            const files = fs.readdirSync(sourceDir).filter(f => f.startsWith('session-') && f.endsWith('.md'));
            for (const file of files) {
                fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
            }
        } catch {
            // Non-fatal: session docs are supplementary
        }
    }

    public static async generateSkill(): Promise<SkillGenerationResult> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage(I18n.getMessage('skill.noWorkspace'));
            return { status: 'no_workspace' };
        }

        const isMultiRoot = workspaceFolders.length > 1;

        interface WorkspaceOption extends vscode.QuickPickItem { projectRoot: string }
        interface ModeOption extends vscode.QuickPickItem { value: 'auto' | 'manual' | '__back__' }
        interface AgentOption extends vscode.QuickPickItem { value: string }

        const workspaceOptions: WorkspaceOption[] = workspaceFolders.map(folder => ({
            label: folder.name || path.basename(folder.uri.fsPath),
            description: folder.uri.fsPath,
            projectRoot: folder.uri.fsPath,
        }));

        const agentOptions: AgentOption[] = [
            { label: '$(arrow-left) Back',          description: '',                                           value: '__back__' },
            { label: '$(file-code) Claude Code',    description: '.claude/skills/edo-tensei/SKILL.md',        value: 'claude' },
            { label: '$(file-code) GitHub Copilot', description: '.github/skills/edo-tensei/SKILL.md',        value: 'copilot' },
            { label: '$(file-code) Kiro IDE',       description: '.kiro/skills/edo-tensei/SKILL.md',          value: 'kiro' },
            { label: '$(file-code) Antigravity',    description: '.agents/skills/edo-tensei/SKILL.md',        value: 'antigravity' },
            { label: '$(file-code) Cline',          description: '.cline/skills/edo-tensei/SKILL.md',         value: 'cline' },
            { label: '$(file-code) Gemini CLI',     description: '.gemini/skills/edo-tensei/SKILL.md',        value: 'gemini' },
            { label: '$(file-code) Cursor',         description: '.cursor/rules/edo-tensei.mdc',              value: 'cursor' },
        ];

        const mapping: Record<string, SkillTarget> = {
            claude:      '.claude',
            copilot:     '.github',
            kiro:        '.kiro',
            antigravity: '.agents',
            cline:       '.cline',
            gemini:      '.gemini',
        };

        type State = 'workspace' | 'mode' | 'agents';
        let state: State = isMultiRoot ? 'workspace' : 'mode';
        let projectRoot = isMultiRoot ? '' : workspaceFolders[0].uri.fsPath;

        // eslint-disable-next-line no-constant-condition
        while (true) {
            if (state === 'workspace') {
                const picked = await vscode.window.showQuickPick(workspaceOptions, {
                    placeHolder: I18n.getMessage('skill.pickWorkspace'),
                });
                if (!picked) { return { status: 'cancelled', projectRoot: '' }; }
                projectRoot = picked.projectRoot;
                state = 'mode';
                continue;
            }

            if (state === 'mode') {
                const modeOptions: ModeOption[] = [
                    ...(isMultiRoot ? [{ label: '$(arrow-left) Back', description: 'Re-select workspace', value: '__back__' as const }] : []),
                    {
                        label: '$(cloud-download) Auto Install (Recommended)',
                        description: 'npx skills add Pain-Labs/Edo-Tensei',
                        detail: 'Installs to all AI agents detected in your workspace',
                        value: 'auto',
                    },
                    {
                        label: '$(file-code) Generate Skill Files Manually',
                        description: 'Pick one or more agents and write files yourself',
                        value: 'manual',
                    },
                ];
                const mode = await vscode.window.showQuickPick(modeOptions, {
                    placeHolder: isMultiRoot
                        ? `Install Edo-Tensei skill into "${workspaceFolders.find(f => f.uri.fsPath === projectRoot)?.name}"`
                        : 'How do you want to install the Edo-Tensei skill?',
                });
                if (!mode) { return { status: 'cancelled', projectRoot }; }
                if (mode.value === '__back__') { state = 'workspace'; continue; }
                if (mode.value === 'auto') {
                    const terminal = vscode.window.createTerminal({ name: 'Edo-Tensei: Install Skill', cwd: projectRoot });
                    terminal.show(true);
                    terminal.sendText('npx skills add Pain-Labs/Edo-Tensei');
                    return { status: 'auto', projectRoot };
                }
                state = 'agents';
                continue;
            }

            const choices = await vscode.window.showQuickPick(agentOptions, {
                placeHolder: 'Select one or more AI agents to generate the skill file for',
                canPickMany: true,
            });
            if (!choices || choices.length === 0) { return { status: 'cancelled', projectRoot }; }
            if (choices.some(c => c.value === '__back__')) { state = 'mode'; continue; }

            const skillPaths: string[] = [];

            for (const choice of choices) {
                if (choice.value === 'cursor') {
                    skillPaths.push(this.generateCursorRule(projectRoot));
                    continue;
                }
                const target = mapping[choice.value];
                if (!target) { continue; }
                skillPaths.push(this.generateVSCodeSkill(projectRoot, target));
            }

            if (skillPaths.length === 0) { return { status: 'cancelled', projectRoot }; }

            const target = choices.map(c => c.value).join(', ');
            return { status: 'generated', target, projectRoot, skillPaths };
        }
    }

    private static assertInsideRoot(filePath: string, root: string): void {
        const resolved = path.resolve(filePath);
        const resolvedRoot = path.resolve(root) + path.sep;
        if (!resolved.startsWith(resolvedRoot)) {
            throw new Error(`Skill path "${resolved}" is outside project root "${resolvedRoot}"`);
        }
    }

    private static generateVSCodeSkill(projectRoot: string, agentType: SkillTarget): string {
        const skillDir = path.join(projectRoot, agentType, 'skills', 'edo-tensei');
        const skillPath = path.join(skillDir, 'SKILL.md');
        this.assertInsideRoot(skillPath, projectRoot);
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(skillPath, this.readSkillMarkdown(), 'utf8');
        this.copySessionDocs(skillDir);
        return skillPath;
    }

    private static generateCursorRule(projectRoot: string): string {
        const rulesDir = path.join(projectRoot, '.cursor', 'rules');
        const rulePath = path.join(rulesDir, 'edo-tensei.mdc');
        this.assertInsideRoot(rulePath, projectRoot);
        fs.mkdirSync(rulesDir, { recursive: true });
        const body = this.readSkillMarkdown().replace(/^---[\s\S]*?---\n\n?/, '');
        const content = `---\ndescription: "Edo Tensei - Recover recent AI IDE context"\nglobs: "*"\n---\n\n${body}`;
        fs.writeFileSync(rulePath, content, 'utf8');
        return rulePath;
    }
}
