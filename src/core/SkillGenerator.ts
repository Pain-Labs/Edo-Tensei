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

const IDE_ORDER: ReadonlyArray<{ slug: string; name: string }> = [
    { slug: 'claude',      name: 'Claude Code' },
    { slug: 'copilot',     name: 'GitHub Copilot' },
    { slug: 'cursor',      name: 'Cursor' },
    { slug: 'codex',       name: 'OpenAI Codex CLI' },
    { slug: 'kiro',        name: 'Kiro' },
    { slug: 'windsurf',    name: 'Windsurf' },
    { slug: 'antigravity', name: 'Antigravity' },
];

export class SkillGenerator {
    public static getProjectRoot(): string | undefined {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return undefined;
        }
        return workspaceFolders[0].uri.fsPath;
    }

    // dist/extension.js is one level below the extension root
    private static getDocsSkillsDir(): string {
        return path.join(__dirname, '..', 'docs', 'skills');
    }

    // Reads docs/skills/session-{slug}.md, extracts the "## Storage Paths"
    // table, and returns a SKILL.md-format path block for that IDE.
    // Returns empty string if the file is missing or the section cannot be parsed.
    private static extractPathsFromDoc(filePath: string, ideName: string): string {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n');
            let inSection = false;
            const bullets: string[] = [];

            for (const line of lines) {
                if (/^## Storage Paths/.test(line)) {
                    inSection = true;
                    continue;
                }
                if (inSection && /^## /.test(line)) {
                    break;
                }
                if (!inSection) {
                    continue;
                }
                const cells = line.split('|').map(c => c.trim()).filter(Boolean);
                if (cells.length < 2) {
                    continue;
                }
                // Skip header row and separator row
                if (/^(OS|Environment|Platform)$/.test(cells[0]) || /^-+$/.test(cells[0])) {
                    continue;
                }
                bullets.push(`- ${cells[0]}: ${cells[1]}`);
            }

            if (bullets.length === 0) {
                return '';
            }
            return `#### ${ideName}\n\n${bullets.join('\n')}\n`;
        } catch {
            return '';
        }
    }

    // Assembles the "Common path patterns" section by reading docs/skills/*.md.
    // Falls back to an inline snapshot if no docs files can be read.
    private static buildPathPatternsSection(): string {
        const docsDir = this.getDocsSkillsDir();
        const sections: string[] = [];

        for (const { slug, name } of IDE_ORDER) {
            const filePath = path.join(docsDir, `session-${slug}.md`);
            const block = this.extractPathsFromDoc(filePath, name);
            if (block) {
                sections.push(block);
            }
        }

        if (sections.length === 0) {
            return this.buildInlinePathPatterns();
        }
        return '\n' + sections.join('\n');
    }

    // Inline fallback used when docs/skills/ files are unavailable.
    private static buildInlinePathPatterns(): string {
        return `
#### Claude Code

- Windows: \`$env:USERPROFILE\\.claude\\projects\\*<project>*\\*.jsonl\`
- Linux/macOS/SSH: \`~/.claude/projects/*<project>*/*.jsonl\`

#### GitHub Copilot

- Windows: \`$env:APPDATA\\Code\\User\\workspaceStorage\\*\\chatSessions\\*.json*\`
- Linux: \`~/.config/Code/User/workspaceStorage/*/chatSessions/*.json*\`
- VS Code Server / SSH: \`~/.vscode-server/data/User/workspaceStorage/*/chatSessions/*.json*\`
- Global empty-window sessions may also exist under \`.../globalStorage/emptyWindowChatSessions/\`

#### Cursor

- Windows: \`$env:APPDATA\\Cursor\\User\\workspaceStorage\\*\\agent-transcripts\\*.jsonl\`
- Linux/macOS: \`~/.config/Cursor/User/workspaceStorage/*/agent-transcripts/*.jsonl\`

#### OpenAI Codex CLI

- \`~/.codex/sessions/rollout-*.jsonl\`

#### Kiro

- Windows: \`$env:APPDATA\\Kiro\\User\\globalStorage\\kiro.kiroagent\\*\\*.chat\`
- Linux/macOS: \`~/.config/Kiro/User/globalStorage/kiro.kiroagent/*/*.chat\`

#### Windsurf

- \`~/.codeium/windsurf/cascade/\`

#### Antigravity

- \`~/.gemini/antigravity/brain/**/overview.txt\`
`;
    }

    public static async generateSkill(): Promise<SkillGenerationResult> {
        const projectRoot = this.getProjectRoot();
        if (!projectRoot) {
            vscode.window.showErrorMessage(I18n.getMessage('skill.noWorkspace'));
            return { status: 'no_workspace' };
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
        fs.writeFileSync(skillPath, this.buildSkillMarkdown(), 'utf8');
        return skillPath;
    }

    private static generateCursorRule(projectRoot: string): string {
        const rulesDir = path.join(projectRoot, '.cursor', 'rules');
        const rulePath = path.join(rulesDir, 'edo-tensei.mdc');
        this.assertInsideRoot(rulePath, projectRoot);
        fs.mkdirSync(rulesDir, { recursive: true });
        fs.writeFileSync(rulePath, this.buildCursorRule(), 'utf8');
        return rulePath;
    }

    private static buildSkillMarkdown(): string {
        const pathPatterns = this.buildPathPatternsSection();
        return `---
name: edo-tensei
description: Find recent AI IDE session files on the local machine, read only the most relevant portion, and produce a structured handoff summary so work can continue from the latest useful context.
argument-hint: "[claude|copilot|cursor|codex|kiro|windsurf|antigravity]"
---

# Edo Tensei

Use this skill when the user wants you to take over work from another AI IDE or recover the latest useful chat/session context without manually pasting the whole conversation.

## Primary Goal

Find the most relevant recent session file for the current project, read it selectively instead of fully, and return a concise handoff summary:

- Goal
- Completed / attempted steps
- Current blocker
- Proposed next steps

## Output Contract

Always return:

\`\`\`
## Session Handoff Summary
**Source IDE**: <ide>
**Session Path**: <path>
**Last Activity**: <timestamp>

### Goal
<1-2 sentences>

### Completed / Attempted
- <item>
- <item>

### Current Blocker
<description or "None">

### Proposed Next Steps
- [ ] <actionable item>
- [ ] <actionable item>
\`\`\`

If the user asks for Chinese, output the same structure in Chinese.

## Layer 0: Scope Gate

Before reading any large file:

1. Confirm the current working directory / workspace name.
2. Prefer the most recent 20% of a session or the last 60-250 lines/messages.
3. Filter to human-facing turns only when possible:
   - \`role === "user"\`
   - \`role === "assistant"\`
   - or message content blocks with \`type === "text"\`
4. Skip tool-call noise unless it explains the blocker.

## Layer 1: Search Strategy

Start from the current workspace name and search the target IDE first if the user specified one. Otherwise search likely IDEs in this order:

1. Claude Code
2. GitHub Copilot
3. Cursor
4. Codex
5. Kiro
6. Windsurf
7. Antigravity

### Common path patterns
${pathPatterns}
## Layer 2: Reading Rules

### Read selectively, never by default in full

- Prefer file tail, recent messages, or keyword-located sections.
- If the file is very large, read only the last segment first.
- Use keywords such as:
  - \`error\`
  - \`TODO\`
  - \`next\`
  - \`blocker\`
  - \`failed\`
  - \`plan\`
  - \`fix\`

### Format-specific parsing guides

#### Claude Code
- Format: JSONL (one JSON object per line)
- Each line: \`message.role\` ("user"/"assistant") and \`message.content[].text\`
- Filter by \`type === "user"\` or \`type === "assistant"\` to skip tool-call noise
- Read from the end of the file for the most recent turns

#### GitHub Copilot
- Format: JSON or JSONL
- JSON: root has \`requests[]\` → each item has \`message.text\` (user) and \`response[].value\` (assistant)
- JSONL: each line is \`{ kind, v }\` where \`v.requests[]\` follows the same structure
- Jump to the last \`requests\` entries for the most recent context

#### Cursor
- Format: JSONL (one JSON object per line)
- Each line: \`role\` ("user"/"assistant") and \`message.content[].text\`
- Read the last 20-30 lines to recover recent context

#### Kiro
- Format: JSON (.chat file)
- Root has \`chat[]\` → each item has \`role\` ("user"/"bot") and \`content\` (string)
- System prompt and instructions appear at the start; skip to user/bot turns
- Search for \`"role":"user"\` to locate where the conversation begins

#### OpenAI Codex CLI
- Format: JSONL
- Each line has \`type\` and \`payload\`
- Look for lines where \`type\` indicates a message or conversation turn
- Read the last N lines for the most recent context

#### Windsurf
- Format: binary / protobuf-like — do not hallucinate contents; fall back to path-based handoff

#### Antigravity
- Format: JSONL (overview.txt, preview-only log)
- Each line: \`source\` ("USER"/"MODEL") and \`input\` or \`content\` field
- Filter by \`source === "USER" || source === "MODEL"\` to get conversation turns
- ⚠ Content is truncated at ~900 chars per message; full history lives in the cloud only

## Layer 3: Halt / Fallback Rules

### Stop and report instead of guessing when:

- The file cannot be read from the local machine.
- The format is unsupported or binary-only.
- Multiple candidate sessions conflict and you cannot infer the right one from workspace/time.

### Required fallback behavior

If local file access is unavailable, say:

> I can't read that local session file from this environment. Please paste the last few user/assistant turns, or let me know which recent session to prioritize.

If the session is too large, say:

> I only read the most recent relevant portion to avoid unnecessary token use. I can inspect earlier sections too if needed.

If the format is binary-only, say:

> I found the session path, but the local format is not directly readable here. I can still produce a path-based handoff instruction.

## Behavior Notes

- Prefer concrete dates and timestamps when clarifying recency.
- Do not claim you read the whole session if you only read the tail.
- Distinguish confirmed facts from your inference.
- Prioritize accuracy over completeness.
`;
    }

    private static buildCursorRule(): string {
        return `---
description: "Edo Tensei - Recover recent AI IDE context"
globs: "*"
---

${this.buildSkillMarkdown().replace(/^---[\s\S]*?---\n\n/, '')}`;
    }
}
