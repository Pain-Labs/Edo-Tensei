import * as vscode from 'vscode';
import * as path from 'path';
import { I18n } from '../i18n';
import { CapturedSession, IChatExtractor } from './extractors/types';
import { CopilotExtractor } from './extractors/CopilotExtractor';
import { CursorExtractor } from './extractors/CursorExtractor';
import { AntigravityExtractor } from './extractors/AntigravityExtractor';
import { KiroExtractor } from './extractors/KiroExtractor';
import { WindsurfExtractor } from './extractors/WindsurfExtractor';
import { ClaudeExtractor } from './extractors/ClaudeExtractor';
import { CodexExtractor } from './extractors/CodexExtractor';

export class SessionHandoffService {
    private extractors: IChatExtractor[];
    private cachedSessions: CapturedSession[] = [];
    private allSessions: CapturedSession[] = [];
    private scanMode: 'project' | 'all' = 'project';
    private _onDidUpdateSessions = new vscode.EventEmitter<void>();
    public readonly onDidUpdateSessions = this._onDidUpdateSessions.event;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.extractors = [
            new CopilotExtractor(),
            new CursorExtractor(),
            new AntigravityExtractor(),
            new KiroExtractor(),
            new WindsurfExtractor(),
            new ClaudeExtractor(),
            new CodexExtractor(),
            // new TraeExtractor(), // TODO: Fix garbled output for Trae
        ];
    }

    private getCustomPaths(ideId: string): string[] {
        try {
            const customConfig = vscode.workspace.getConfiguration('edoTensei').get<Record<string, string[]>>('customScanPaths') || {};
            const custom = customConfig[ideId];
            return Array.isArray(custom) ? custom : [];
        } catch {
            return [];
        }
    }

    /**
     * Scan for ALL sessions that match the current workspace (project).
     */
    async scanProjectSessions(): Promise<CapturedSession[]> {
        this.scanMode = 'project';
        this.cachedSessions = [];
        this._onDidUpdateSessions.fire(); // Clear UI immediately

        const workspacePath = this.getWorkspaceRoot()?.fsPath;
        if (!workspacePath) {
            return [];
        }

        await Promise.all(
            this.extractors.map(async (e) => {
                try {
                    const sessions = await e.extractAll(workspacePath, this.getCustomPaths(e.ideId));
                    const matched = sessions.filter((s) => this.isSameWorkspace(s, workspacePath) && s.messages.length > 0);
                    if (matched.length > 0) {
                        this.cachedSessions.push(...matched);
                        this.cachedSessions.sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
                        this._onDidUpdateSessions.fire(); // Stream update
                    }
                } catch (err) {
                    console.error(`[SessionHandoffService] Error extracting from ${e.ideId}:`, err);
                }
            })
        );
        return this.cachedSessions;
    }

    /**
     * Scan for ALL sessions from all supported IDEs.
     */
    async scanAllSessions(): Promise<CapturedSession[]> {
        this.scanMode = 'all';
        this.allSessions = [];
        this._onDidUpdateSessions.fire(); // Clear UI immediately

        await Promise.all(
            this.extractors.map(async (e) => {
                try {
                    // Fetch-all should not be constrained by current workspace.
                    const sessions = await e.extractAll(undefined, this.getCustomPaths(e.ideId));
                    if (sessions.length > 0) {
                        this.allSessions.push(...sessions);
                        this.allSessions.sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
                        this._onDidUpdateSessions.fire(); // Stream update
                    }
                } catch (err) {
                    console.error(`[SessionHandoffService] Error extracting all from ${e.ideId}:`, err);
                }
            })
        );
        return this.allSessions;
    }

    /**
     * Backward compatibility for existing code.
     */
    async scanAllIDEs(): Promise<CapturedSession[]> {
        return this.scanProjectSessions();
    }

    getSessions(): CapturedSession[] {
        return this.scanMode === 'all' ? this.allSessions : this.cachedSessions;
    }

    getScanMode(): 'project' | 'all' {
        return this.scanMode;
    }

    private normalizePath(p: string): string {
        return path.resolve(p).replace(/\\/g, '/').toLowerCase();
    }

    /**
     * Best-effort matching: prefer explicit workspacePath, fall back to rawPath substring match.
     */
    private isSameWorkspace(session: CapturedSession, workspacePath: string): boolean {
        const ws = this.normalizePath(workspacePath);

        if (session.workspacePath) {
            return this.normalizePath(session.workspacePath) === ws;
        }

        if (session.rawPath) {
            const raw = this.normalizePath(session.rawPath);
            return raw.includes(ws);
        }

        return false;
    }

    getGroupedSessions(): Map<string, CapturedSession[]> {
        const sessions = this.getSessions();
        const groups = new Map<string, CapturedSession[]>();
        
        // Ensure all known IDEs have a group, even if empty
        for (const e of this.extractors) {
            groups.set(e.ideId, []);
        }

        for (const s of sessions) {
            const group = groups.get(s.sourceIde) || [];
            group.push(s);
            groups.set(s.sourceIde, group);
        }
        return groups;
    }

    public getWorkspaceRoot(): vscode.Uri | undefined {
        const folders = vscode.workspace.workspaceFolders;
        return folders && folders.length > 0 ? folders[0].uri : undefined;
    }

    // Per-IDE reading guides for path handoff mode.
    // IDEs with unreadable binary formats (e.g. windsurf protobuf) are intentionally omitted
    // so the caller can detect the absence and fall back to full-text mode.
    private static readonly IDE_READ_GUIDES: Partial<Record<CapturedSession['sourceIde'], string>> = {
        copilot: [
            'Format: JSON or JSONL',
            '- JSON: root has `requests[]` → each item has `message.text` (user) and `response[].value` (assistant)',
            '- JSONL: each line is `{ kind, v }` where `v.requests[]` follows the same structure',
            '- Tip: jump to the last `requests` entries for the most recent context',
        ].join('\n'),
        claude: [
            'Format: JSONL (one JSON object per line)',
            '- Each line has `message.role` ("user"/"assistant") and `message.content[].text`',
            '- Filter by `type === "user"` or `type === "assistant"` to skip tool-call noise',
            '- Tip: read from the end of the file for the most recent turns',
        ].join('\n'),
        cursor: [
            'Format: JSONL (one JSON object per line)',
            '- Each line has `role` ("user"/"assistant") and `message.content[].text`',
            '- Tip: read the last 20-30 lines to recover recent context',
        ].join('\n'),
        kiro: [
            'Format: JSON (.chat file)',
            '- Root has `chat[]` → each item has `role` ("user"/"bot") and `content` (string)',
            '- Note: system prompt and instructions appear at the start; skip to user/bot turns',
            '- Tip: search for `"role":"user"` to locate where the conversation begins',
        ].join('\n'),
        antigravity: [
            'Format: JSONL (overview.txt, preview-only log)',
            '- Each line has `source` ("USER"/"MODEL") and `input` or `content` field',
            '- Filter by `source === "USER" || source === "MODEL"` to get conversation turns',
            '- ⚠ Content is truncated at ~900 chars per message; full history lives in the cloud only',
        ].join('\n'),
        codex: [
            'Format: JSONL',
            '- Each line has `type` and `payload`',
            '- Look for lines where `type` indicates a message or conversation turn',
            '- Tip: read the last N lines for the most recent context',
        ].join('\n'),
    };

    public buildPromptFromCapturedSession(session: CapturedSession): string {
        const config = vscode.workspace.getConfiguration('edoTensei');
        const lang = config.get<string>('promptLanguage') || 'English';
        const mode = config.get<string>('handoffMode') || 'path';

        if (mode === 'path') {
            const guide = SessionHandoffService.IDE_READ_GUIDES[session.sourceIde];
            if (guide) {
                return this.buildPathHandoffPrompt(session, lang, guide);
            }
            // Binary / unsupported format — fall back to full text with a note
        }

        return this.buildFullTextPrompt(session, lang);
    }

    private buildPathHandoffPrompt(session: CapturedSession, lang: string, guide: string): string {
        switch (lang) {
            case 'Traditional Chinese':
                return [
                    `你正在接手一個既有任務（來自 ${session.sourceIde}）。請不要要求我貼上完整對話。`,
                    '',
                    '1) 先讀這個 session 檔案（或其最新段落）：',
                    session.rawPath,
                    '',
                    '2) 讀檔格式與策略（按需，不要全讀）：',
                    guide,
                    '- 優先找：使用者目標、已嘗試的解法、目前卡住點、最後 20% 的對話',
                    '- 若檔案過大：只讀最後 N 則訊息，或依關鍵字（error / TODO / next）定位',
                    '',
                    '3) 讀完後請輸出：',
                    '- 你理解的目標（1-2 句）',
                    '- 已完成 / 已嘗試（條列）',
                    '- 你要採取的下一步（可執行清單）',
                    '',
                    '※ 若你沒有讀本機檔案的能力：請告知，使用者會改為手動貼上最後若干則訊息。',
                ].join('\n');
            case 'Simplified Chinese':
                return [
                    `你正在接手一个既有任务（来自 ${session.sourceIde}）。请不要要求我贴上完整对话。`,
                    '',
                    '1) 先读这个 session 文件（或其最新片段）：',
                    session.rawPath,
                    '',
                    '2) 读档格式与策略（按需，不要全读）：',
                    guide,
                    '- 优先找：用户目标、已尝试的解法、当前卡点、最后 20% 的对话',
                    '- 若文件过大：只读最后 N 条消息，或按关键词（error / TODO / next）定位',
                    '',
                    '3) 读完后请输出：',
                    '- 你理解的目标（1-2 句）',
                    '- 已完成 / 已尝试（列表）',
                    '- 你要采取的下一步（可执行清单）',
                    '',
                    '※ 如果你没有读取本地文件的能力：请直接说明，用户会改为手动贴上最后几条消息。',
                ].join('\n');
            case 'Japanese':
                return [
                    `あなたは既存のタスク（${session.sourceIde} から）を引き継ぎます。会話全文の貼り付けは求めないでください。`,
                    '',
                    '1) まずこの session ファイル（または最新部分）を読んでください：',
                    session.rawPath,
                    '',
                    '2) ファイル形式と読み方（必要な箇所だけを読む）：',
                    guide,
                    '- 優先して確認：ユーザーの目的、試した解決策、現在の詰まりどころ、会話の最後 20%',
                    '- ファイルが大きい場合：最後の N 件だけ読むか、キーワード（error / TODO / next）で探してください',
                    '',
                    '3) 読了後に出力してください：',
                    '- あなたが理解した目標（1〜2文）',
                    '- 完了済み / 試行済みの内容（箇条書き）',
                    '- 次に取るべき行動（実行可能なチェックリスト）',
                    '',
                    '※ ローカルファイルを読めない場合はそう伝えてください。ユーザーが直近のメッセージを手動で貼ります。',
                ].join('\n');
            case 'Korean':
                return [
                    `당신은 기존 작업(${session.sourceIde}에서 이어받음)을 인계받고 있습니다. 전체 대화를 붙여 달라고 요청하지 마세요.`,
                    '',
                    '1) 먼저 이 session 파일(또는 최신 부분)을 읽어 주세요:',
                    session.rawPath,
                    '',
                    '2) 파일 형식과 읽기 전략(필요한 부분만 선별적으로 읽기):',
                    guide,
                    '- 우선 확인할 것: 사용자 목표, 이미 시도한 해결책, 현재 막힌 지점, 대화의 마지막 20%',
                    '- 파일이 크다면: 마지막 N개 메시지만 읽거나, 키워드(error / TODO / next)로 위치를 찾으세요',
                    '',
                    '3) 읽은 뒤 다음을 출력해 주세요:',
                    '- 당신이 이해한 목표 (1~2문장)',
                    '- 완료됨 / 시도됨 항목 (불릿 목록)',
                    '- 다음에 취할 단계 (실행 가능한 체크리스트)',
                    '',
                    '※ 로컬 파일을 읽을 수 없다면 그렇게 알려 주세요. 사용자가 최근 메시지를 수동으로 붙여 넣을 것입니다.',
                ].join('\n');
            default:
                return [
                    `You are taking over an existing task (from ${session.sourceIde}). Do not ask me to paste the full conversation.`,
                    '',
                    '1) Read this session file (or its most recent portion):',
                    session.rawPath,
                    '',
                    '2) File format & reading strategy (read selectively, not in full):',
                    guide,
                    '- Prioritize: user goal, attempted solutions, current blocker, last 20% of conversation',
                    '- If the file is large: read only the last N messages, or locate by keyword (error / TODO / next)',
                    '',
                    '3) After reading, output:',
                    '- Your understanding of the goal (1-2 sentences)',
                    '- Completed / attempted steps (bullet list)',
                    '- Your proposed next steps (actionable checklist)',
                    '',
                    '※ If you lack file-read capability: say so and the user will paste the last few messages manually.',
                ].join('\n');
        }
    }
    private buildFullTextPrompt(session: CapturedSession, lang: string): string {
        let introText: string;

        switch (lang) {
            case 'Traditional Chinese':
                introText = `你現在接手來自 ${session.sourceIde} 的上一段 AI session，請先閱讀以下對話歷史並先用你的話總結目前理解（包含目前的目標、已嘗試的方法與下一步），再提出接手後的執行計畫：`;
                break;
            case 'Simplified Chinese':
                introText = `你现在接手来自 ${session.sourceIde} 的上一段 AI session，请先阅读以下对话历史，并用你的话总结目前理解（包括当前目标、已尝试的方法与下一步），再提出接手后的执行计划：`;
                break;
            case 'Japanese':
                introText = `あなたは ${session.sourceIde} の前回の AI セッションを引き継ぎます。以下の会話履歴を読み、まず現時点の理解（現在の目標、試した方法、次の一手）を自分の言葉で要約してから、作業を続けるための実行計画を提案してください：`;
                break;
            case 'Korean':
                introText = `당신은 ${session.sourceIde}의 이전 AI 세션을 이어받습니다. 아래 대화 기록을 먼저 읽고 현재 이해한 내용(현재 목표, 시도한 방법, 다음 단계)을 자신의 말로 요약한 뒤, 작업을 계속하기 위한 실행 계획을 제안해 주세요:`;
                break;
            default:
                introText = `You are now taking over a previous AI session from ${session.sourceIde}. Please read the following conversation history and summarize your current understanding (including the current goals, attempted methods, and next steps) before proposing an execution plan to continue the work:`;
                break;
        }

        const lines: string[] = [introText, ''];

        lines.push('---');
        for (const msg of session.messages) {
            lines.push(`[${msg.role.toUpperCase()}]`);
            if (msg.thought) {
                lines.push(`🤔 思考過程:\n${msg.thought}\n`);
            }
            if (msg.toolCalls && msg.toolCalls.length > 0) {
                lines.push(`🛠️ 工具調用: ${msg.toolCalls.length} 次`);
            }
            lines.push(msg.content);
            lines.push('');
        }
        lines.push('---');
        lines.push('');

        return lines.join('\n');
    }
    public buildReadableTranscript(session: CapturedSession): string {
        const date = new Date(session.capturedAt);
        const dateStr = date.toLocaleString();
        const projectName = session.workspacePath ? path.basename(session.workspacePath) : undefined;
        const ideName = session.sourceIde.charAt(0).toUpperCase() + session.sourceIde.slice(1);

        const lines: string[] = [
            `# ${ideName}${projectName ? ` — ${projectName}` : ''}`,
            I18n.getMessage('transcript.messages', dateStr, String(session.messages.length)),
            '',
        ];

        for (const msg of session.messages) {
            lines.push('---');
            lines.push('');
            lines.push(`### ${msg.role.toUpperCase()}`);
            if (msg.thought) {
                lines.push('');
                lines.push(I18n.getMessage('transcript.thought'));
                lines.push('');
                lines.push(msg.thought);
            }
            if (msg.toolCalls && msg.toolCalls.length > 0) {
                lines.push('');
                lines.push(I18n.getMessage('transcript.toolCalls', String(msg.toolCalls.length)));
            }
            if (msg.content) {
                lines.push('');
                lines.push(msg.content);
            }
            lines.push('');
        }

        lines.push('---');
        return lines.join('\n');
    }

    public getCachedSessions(): CapturedSession[] {
        return this.cachedSessions;
    }
}

