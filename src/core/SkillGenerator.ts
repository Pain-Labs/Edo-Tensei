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

        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const activeFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
            if (activeFolder) {
                return activeFolder.uri.fsPath;
            }
        }

        const items = workspaceFolders.map(folder => ({
            label: folder.name,
            description: folder.uri.fsPath,
            folder: folder
        }));

        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: I18n.getMessage('skill.pickWorkspace'),
        });

        return picked?.folder.uri.fsPath;
    }

    private static getSkillsSourceDir(): string {
        return path.join(__dirname, '..', 'skills', 'edo-tensei');
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

        const projectRoot = await this.getProjectRoot();
        if (!projectRoot) {
            return { status: 'cancelled', projectRoot: '' };
        }

        const options = [
            'Claude Code (.claude/skills/edo-tensei/SKILL.md)',
            'GitHub Copilot (.github/skills/edo-tensei/SKILL.md)',
            'Kiro IDE (.kiro/skills/edo-tensei/SKILL.md)',
            'Antigravity (.agents/skills/edo-tensei/SKILL.md)',
            'Cline (.cline/skills/edo-tensei/SKILL.md)',
            'Gemini CLI (.gemini/skills/edo-tensei/SKILL.md)',
            'Cursor (.cursor/rules/edo-tensei.mdc)',
        ];

        const choices = await vscode.window.showQuickPick(options, {
            placeHolder: I18n.getMessage('skill.pickTarget'),
            canPickMany: true,
        });

        if (!choices || choices.length === 0) {
            return { status: 'cancelled', projectRoot };
        }

        const mapping: Record<string, SkillTarget> = {
            Claude: '.claude',
            'GitHub Copilot': '.github',
            Kiro: '.kiro',
            Antigravity: '.agents',
            Cline: '.cline',
            'Gemini CLI': '.gemini',
        };

        const skillPaths: string[] = [];

        for (const choice of choices) {
            if (choice.startsWith('Cursor')) {
                skillPaths.push(this.generateCursorRule(projectRoot));
                continue;
            }
            const key = Object.keys(mapping).find((entry) => choice.startsWith(entry));
            if (!key) { continue; }
            skillPaths.push(this.generateVSCodeSkill(projectRoot, mapping[key]));
        }

        if (skillPaths.length === 0) {
            return { status: 'cancelled', projectRoot };
        }

        const target = skillPaths.map(p => path.relative(projectRoot, p).split(path.sep)[0]).join(', ');
        return { status: 'generated', target, projectRoot, skillPaths };
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
