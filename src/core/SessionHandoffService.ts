import * as fs from 'fs';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { I18n } from '../i18n';
import { CapturedSession, IChatExtractor } from './extractors/types';
import { CopilotExtractor } from './extractors/CopilotExtractor';
import { CursorExtractor } from './extractors/CursorExtractor';
import { AntigravityExtractor } from './extractors/AntigravityExtractor';
import { KiroExtractor } from './extractors/KiroExtractor';
import { ClaudeExtractor } from './extractors/ClaudeExtractor';
import { CodexExtractor } from './extractors/CodexExtractor';

export class SessionHandoffService {
    private extractors: IChatExtractor[];
    private cachedSessions: CapturedSession[] = [];
    private allSessions: CapturedSession[] = [];
    private scanMode: 'project' | 'all' = 'project';
    private scanning = false;
    private ideScanStatus = new Map<CapturedSession['sourceIde'], { state: 'idle' | 'scanning' | 'done' | 'error'; found: number }>();
    private _onDidUpdateSessions = new vscode.EventEmitter<void>();
    public readonly onDidUpdateSessions = this._onDidUpdateSessions.event;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.extractors = [
            new CopilotExtractor(),
            new CursorExtractor(),
            new AntigravityExtractor(),
            new KiroExtractor(),
            new ClaudeExtractor(),
            new CodexExtractor(),
            // [TODO] Windsurf extraction is intentionally disabled until a reliable parser exists.
            // new WindsurfExtractor(),
            // [TODO] Trae extraction is intentionally disabled until a reliable parser exists.
            // new TraeExtractor(),
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

    public getKnownIdeIds(): CapturedSession['sourceIde'][] {
        return this.extractors.map(e => e.ideId);
    }

    public isScanning(): boolean {
        return this.scanning;
    }

    public getIdeScanStatus(): Map<CapturedSession['sourceIde'], { state: 'idle' | 'scanning' | 'done' | 'error'; found: number }> {
        return this.ideScanStatus;
    }

    private resetIdeScanStatus(): void {
        this.ideScanStatus = new Map();
        for (const e of this.extractors) {
            this.ideScanStatus.set(e.ideId, { state: 'idle', found: 0 });
        }
    }

    private updateIdeScanStatus(ideId: CapturedSession['sourceIde'], patch: Partial<{ state: 'idle' | 'scanning' | 'done' | 'error'; found: number }>): void {
        const prev = this.ideScanStatus.get(ideId) ?? { state: 'idle' as const, found: 0 };
        this.ideScanStatus.set(ideId, { ...prev, ...patch });
    }

    /**
     * Scan for ALL sessions that match any of the current workspace folders (project).
     * Supports multi-root workspaces.
     */
    async scanProjectSessions(): Promise<CapturedSession[]> {
        this.scanMode = 'project';
        this.cachedSessions = [];
        this.scanning = true;
        this.resetIdeScanStatus();
        for (const e of this.extractors) {
            this.updateIdeScanStatus(e.ideId, { state: 'scanning', found: 0 });
        }
        this._onDidUpdateSessions.fire(); // Clear UI immediately

        const workspacePaths = this.getWorkspaceRoots().map(uri => uri.fsPath);
        if (workspacePaths.length === 0) {
            return [];
        }

        await Promise.all(
            this.extractors.map(async (e) => {
                try {
                    const customPaths = this.getCustomPaths(e.ideId);

                    let sessions: CapturedSession[] = [];
                    if (workspacePaths.length <= 1) {
                        // Single-root workspace: keep the simple and fast path.
                        sessions = await e.extractAll(workspacePaths[0], customPaths);
                    } else {
                        // Multi-root workspace: some extractors use workspacePath as a lookup key.
                        // Extract per root, then merge.
                        const perRoot = await Promise.all(
                            workspacePaths.map(ws => e.extractAll(ws, customPaths))
                        );
                        const merged = new Map<string, CapturedSession>();
                        for (const list of perRoot) {
                            for (const s of list) {
                                merged.set(s.rawPath, s);
                            }
                        }
                        sessions = [...merged.values()];
                    }

                    const matched = sessions.filter((s) => this.isAnyWorkspace(s, workspacePaths) && s.messages.length > 0);
                    if (matched.length > 0) {
                        this.cachedSessions.push(...matched);
                        const prev = this.ideScanStatus.get(e.ideId)?.found ?? 0;
                        this.updateIdeScanStatus(e.ideId, { found: prev + matched.length });
                        this._onDidUpdateSessions.fire();
                    }

                    this.updateIdeScanStatus(e.ideId, { state: 'done' });
                    this._onDidUpdateSessions.fire();
                } catch (err) {
                    this.updateIdeScanStatus(e.ideId, { state: 'error' });
                    this._onDidUpdateSessions.fire();
                    console.error(`[SessionHandoffService] Error extracting from ${e.ideId}:`, err);
                }
            })
        );

        this.cachedSessions.sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
        this.scanning = false;
        this._onDidUpdateSessions.fire();
        return this.cachedSessions;
    }

    /**
     * Scan for ALL sessions from all supported IDEs.
     */
    async scanAllSessions(): Promise<CapturedSession[]> {
        this.scanMode = 'all';
        this.allSessions = [];
        this.scanning = true;
        this.resetIdeScanStatus();
        for (const e of this.extractors) {
            this.updateIdeScanStatus(e.ideId, { state: 'scanning', found: 0 });
        }
        this._onDidUpdateSessions.fire(); // Clear UI immediately

        await Promise.all(
            this.extractors.map(async (e) => {
                try {
                    // Fetch-all should not be constrained by current workspace.
                    const sessions = await e.extractAll(undefined, this.getCustomPaths(e.ideId));
                    if (sessions.length > 0) {
                        this.allSessions.push(...sessions);
                        const prev = this.ideScanStatus.get(e.ideId)?.found ?? 0;
                        this.updateIdeScanStatus(e.ideId, { found: prev + sessions.length });
                        this._onDidUpdateSessions.fire();
                    }
                    this.updateIdeScanStatus(e.ideId, { state: 'done' });
                    this._onDidUpdateSessions.fire();
                } catch (err) {
                    this.updateIdeScanStatus(e.ideId, { state: 'error' });
                    this._onDidUpdateSessions.fire();
                    console.error(`[SessionHandoffService] Error extracting all from ${e.ideId}:`, err);
                }
            })
        );

        this.allSessions.sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
        this.scanning = false;
        this._onDidUpdateSessions.fire();
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
            const sessionWs = this.normalizePath(session.workspacePath);
            if (sessionWs === ws) {
                return true;
            }
            // Some IDEs (notably VS Code/Copilot workspaceStorage) may store a workspace file path
            // (e.g. a .code-workspace) instead of a folder path. Treat containment as a match.
            if (sessionWs.includes(ws) || ws.includes(sessionWs)) {
                return true;
            }
        }

        if (session.rawPath) {
            const raw = this.normalizePath(session.rawPath);
            return raw.includes(ws);
        }

        return false;
    }

    /**
     * Returns true if the session matches any of the provided workspace paths.
     * Used for multi-root workspace support.
     */
    private isAnyWorkspace(session: CapturedSession, workspacePaths: string[]): boolean {
        return workspacePaths.some(wp => this.isSameWorkspace(session, wp));
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

    /**
     * Returns the URIs of all workspace roots in a multi-root workspace.
     */
    public getWorkspaceRoots(): vscode.Uri[] {
        return (vscode.workspace.workspaceFolders ?? []).map(f => f.uri);
    }

    public hasSkillInstalled(): boolean {
        return this.getWorkspaceRoots().some(uri =>
            SessionHandoffService.detectSkillInWorkspace(uri.fsPath)
        );
    }

    private static detectSkillInWorkspace(projectRoot: string): boolean {
        const skillDirs = ['.claude', '.cline', '.kiro', '.agents', '.github', '.gemini'];
        for (const dir of skillDirs) {
            if (fs.existsSync(path.join(projectRoot, dir, 'skills', 'edo-tensei', 'SKILL.md'))) {
                return true;
            }
        }
        return fs.existsSync(path.join(projectRoot, '.cursor', 'rules', 'edo-tensei.mdc'));
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

    private static readonly LARGE_SESSION_THRESHOLD_TOKENS = 15000;

    /** Estimate token count for a session (char count ÷ 3.5, same heuristic as TreeView) */
    private estimateSessionTokens(session: CapturedSession): number {
        let chars = 0;
        for (const msg of session.messages) {
            if (msg.content) { chars += msg.content.length; }
            if (msg.thought) { chars += msg.thought.length; }
        }
        return Math.round(chars / 3.5);
    }

    private buildLargeSessionWarning(tokens: number, lang: string): string {
        const tokenStr = tokens >= 1000 ? `~${(tokens / 1000).toFixed(1)}k` : `~${tokens}`;
        switch (lang) {
            case 'Traditional Chinese':
                return [
                    `⚠️ 注意：此 session 估計有 ${tokenStr} tokens，直接交接會消耗大量 context 額度。`,
                    '建議先在原本的 IDE 中請 AI 壓縮此 session（例如：「請將我們的對話壓縮成一份精簡的任務摘要」），再進行交接。',
                    '',
                ].join('\n');
            case 'Simplified Chinese':
                return [
                    `⚠️ 注意：此 session 估计有 ${tokenStr} tokens，直接交接会消耗大量 context 额度。`,
                    '建议先在原 IDE 中请 AI 压缩此 session（例如："请将我们的对话压缩成一份精简的任务摘要"），再进行交接。',
                    '',
                ].join('\n');
            case 'Japanese':
                return [
                    `⚠️ 注意：このセッションは推定 ${tokenStr} トークンあります。そのまま引き継ぐと大量のコンテキストを消費します。`,
                    '元の IDE で AI にセッションを圧縮してもらってから（例：「会話を簡潔なタスクサマリーにまとめてください」）引き継ぐことをお勧めします。',
                    '',
                ].join('\n');
            case 'Korean':
                return [
                    `⚠️ 주의: 이 세션은 약 ${tokenStr} 토큰으로 추정됩니다. 그대로 인계하면 많은 컨텍스트를 소비합니다.`,
                    '원본 IDE에서 AI에게 세션을 압축해 달라고 요청한 후 인계하는 것을 권장합니다 (예: "대화를 간결한 작업 요약으로 압축해 주세요").',
                    '',
                ].join('\n');
            default:
                return [
                    `⚠️ Large session: estimated ${tokenStr} tokens. Handing this off directly will consume significant context budget.`,
                    'Consider asking the AI in the original IDE to compress this session first (e.g. "Summarize our conversation into a concise task brief"), then hand off.',
                    '',
                ].join('\n');
        }
    }

    public buildPromptFromCapturedSession(session: CapturedSession): string {
        const config = vscode.workspace.getConfiguration('edoTensei');
        const lang = config.get<string>('promptLanguage') || 'English';
        const mode = config.get<string>('handoffMode') || 'path';

        const tokens = this.estimateSessionTokens(session);
        const largeWarning = tokens >= SessionHandoffService.LARGE_SESSION_THRESHOLD_TOKENS
            ? this.buildLargeSessionWarning(tokens, lang)
            : '';

        if (mode === 'path') {
            const guide = SessionHandoffService.IDE_READ_GUIDES[session.sourceIde];
            if (guide) {
                const skillFound = this.hasSkillInstalled();
                const prompt = this.buildPathHandoffPrompt(session, lang, guide, skillFound);
                return largeWarning ? largeWarning + prompt : prompt;
            }
            // Binary / unsupported format — fall back to full text with a note
        }

        const prompt = this.buildFullTextPrompt(session, lang);
        return largeWarning ? largeWarning + prompt : prompt;
    }

    /**
     * 建立用於存檔用的內容（Parsed Session）。
     * 匯出的 .md 檔案應與 UI 點擊預覽的格式一致，不包含 Prompt 提示語。
     */
    public buildExportContent(session: CapturedSession): string {
        return this.buildReadableTranscript(session);
    }

    /**
     * Copy Context Prompt — 強制 Full Text 模式（全文內嵌）。
     * 不受 `handoffMode` 設定影響。適合貼入無法讀取本機檔案的 AI。
     */
    public buildContextPrompt(session: CapturedSession): string {
        const config = vscode.workspace.getConfiguration('edoTensei');
        const lang = config.get<string>('promptLanguage') || 'English';
        const tokens = this.estimateSessionTokens(session);
        const largeWarning = tokens >= SessionHandoffService.LARGE_SESSION_THRESHOLD_TOKENS
            ? this.buildLargeSessionWarning(tokens, lang)
            : '';
        const prompt = this.buildFullTextPrompt(session, lang);
        return largeWarning ? largeWarning + prompt : prompt;
    }

    /**
     * Copy Reference Prompt — 強制 Path 模式（僅含路徑與讀檔指引）。
     * 不受 `handoffMode` 設定影響。適合能讀取本機檔案的 AI（如 Claude / Cursor）。
     * 若該 IDE 格式不支援 path mode（如 Windsurf 加密 binary），回退至 full text。
     */
    public buildReferencePrompt(session: CapturedSession): string {
        const config = vscode.workspace.getConfiguration('edoTensei');
        const lang = config.get<string>('promptLanguage') || 'English';
        const tokens = this.estimateSessionTokens(session);
        const largeWarning = tokens >= SessionHandoffService.LARGE_SESSION_THRESHOLD_TOKENS
            ? this.buildLargeSessionWarning(tokens, lang)
            : '';

        const guide = SessionHandoffService.IDE_READ_GUIDES[session.sourceIde];
        if (guide) {
            const skillFound = this.hasSkillInstalled();
            const prompt = this.buildPathHandoffPrompt(session, lang, guide, skillFound);
            return largeWarning ? largeWarning + prompt : prompt;
        }

        // Binary / unsupported format — fall back to full text
        const prompt = this.buildFullTextPrompt(session, lang);
        return largeWarning ? largeWarning + prompt : prompt;
    }

    private buildSkillInvocationPrompt(session: CapturedSession, lang: string, guide: string): string {
        const ide = session.sourceIde;
        const filePath = session.rawPath ?? '';
        switch (lang) {
            case 'Traditional Chinese':
                return [
                    `你正在接手一個既有任務（來自 ${ide}）。`,
                    '',
                    '此專案已安裝 **edo-tensei** skill / rule。',
                    '',
                    '若你所在的 IDE 支援直接呼叫專案 skill，可先嘗試：',
                    '',
                    `/edo-tensei ${ide}`,
                    '',
                    '若不支援 slash command，或呼叫失敗，請改用以下方式手動讀取 session：',
                    '',
                    'Session 檔案路徑：',
                    filePath,
                    '',
                    '讀檔格式與策略（按需，不要全讀）：',
                    guide,
                    '- 優先找：使用者目標、已嘗試的解法、目前卡住點、最後 20% 的對話',
                    '- 若檔案過大：只讀最後 N 則訊息，或依關鍵字（error / TODO / next）定位',
                    '',
                    '讀完後請輸出：',
                    '- 你理解的目標（1-2 句）',
                    '- 已完成 / 已嘗試（條列）',
                    '- 你要採取的下一步（可執行清單）',
                    '',
                    '※ 若你沒有 edo-tensei skill，或無法讀取本機檔案，請告知，我會改為提供完整內嵌內容。',
                ].join('\n');
            case 'Simplified Chinese':
                return [
                    `你正在接手一个既有任务（来自 ${ide}）。`,
                    '',
                    '此项目已安装 **edo-tensei** skill / rule。',
                    '',
                    '如果你所在的 IDE 支持直接调用项目 skill，可先尝试：',
                    '',
                    `/edo-tensei ${ide}`,
                    '',
                    '如果不支持 slash command，或调用失败，请改用下面的方式手动读取 session：',
                    '',
                    'Session 文件路径：',
                    filePath,
                    '',
                    '读档格式与策略（按需，不要全读）：',
                    guide,
                    '- 优先找：用户目标、已尝试的解法、当前卡点、最后 20% 的对话',
                    '- 若文件过大：只读最后 N 条消息，或按关键词（error / TODO / next）定位',
                    '',
                    '读完后请输出：',
                    '- 你理解的目标（1-2 句）',
                    '- 已完成 / 已尝试（列表）',
                    '- 你要采取的下一步（可执行清单）',
                    '',
                    '※ 如果你没有 edo-tensei skill，或无法读取本地文件，请告知，我会改为提供完整内嵌内容。',
                ].join('\n');
            case 'Japanese':
                return [
                    `あなたは既存のタスク（${ide} から）を引き継ぎます。`,
                    '',
                    'このプロジェクトには **edo-tensei** skill / rule が入っています。',
                    '',
                    '現在の IDE がプロジェクト skill の直接呼び出しに対応しているなら、まず次を試してください：',
                    '',
                    `/edo-tensei ${ide}`,
                    '',
                    'slash command に対応していない、または呼び出しに失敗した場合は、次の方法で手動読取に切り替えてください：',
                    '',
                    'Session ファイルのパス：',
                    filePath,
                    '',
                    'ファイル形式と読み方（必要な箇所だけを読む）：',
                    guide,
                    '- 優先して確認：ユーザーの目的、試した解決策、現在の詰まりどころ、会話の最後 20%',
                    '- ファイルが大きい場合：最後の N 件だけ読むか、キーワード（error / TODO / next）で探してください',
                    '',
                    '読了後に出力してください：',
                    '- あなたが理解した目標（1〜2文）',
                    '- 完了済み / 試行済みの内容（箇条書き）',
                    '- 次に取るべき行動（実行可能なチェックリスト）',
                    '',
                    '※ edo-tensei skill がない、またはローカルファイルを読めない場合は知らせてください。完全な埋め込み内容に切り替えます。',
                ].join('\n');
            case 'Korean':
                return [
                    `당신은 기존 작업(${ide}에서 이어받음)을 인계받고 있습니다.`,
                    '',
                    '이 프로젝트에는 **edo-tensei** skill / rule이 설치되어 있습니다.',
                    '',
                    '현재 IDE가 프로젝트 skill 직접 호출을 지원한다면 먼저 다음을 시도해 주세요:',
                    '',
                    `/edo-tensei ${ide}`,
                    '',
                    'slash command를 지원하지 않거나 호출에 실패하면 아래 방식으로 수동 읽기를 진행해 주세요:',
                    '',
                    'Session 파일 경로:',
                    filePath,
                    '',
                    '파일 형식과 읽기 전략(필요한 부분만 선별적으로 읽기):',
                    guide,
                    '- 우선 확인할 것: 사용자 목표, 이미 시도한 해결책, 현재 막힌 지점, 대화의 마지막 20%',
                    '- 파일이 크다면: 마지막 N개 메시지만 읽거나, 키워드(error / TODO / next)로 위치를 찾으세요',
                    '',
                    '읽은 뒤 다음을 출력해 주세요:',
                    '- 당신이 이해한 목표 (1~2문장)',
                    '- 완료됨 / 시도됨 항목 (불릿 목록)',
                    '- 다음에 취할 단계 (실행 가능한 체크리스트)',
                    '',
                    '※ edo-tensei skill이 없거나 로컬 파일을 읽을 수 없다면 알려 주세요. 전체 내장 내용으로 전환합니다.',
                ].join('\n');
            default:
                return [
                    `You are taking over an existing task (from ${ide}).`,
                    '',
                    'This project has the **edo-tensei** skill / rule installed.',
                    '',
                    'If your current IDE supports direct project-skill invocation, try:',
                    '',
                    `/edo-tensei ${ide}`,
                    '',
                    'If slash commands are not supported, or the invocation fails, fall back to the manual file-read flow below:',
                    '',
                    'Session file path:',
                    filePath,
                    '',
                    'File format & reading strategy (read selectively, not in full):',
                    guide,
                    '- Prioritize: user goal, attempted solutions, current blocker, last 20% of conversation',
                    '- If the file is large: read only the last N messages, or locate by keyword (error / TODO / next)',
                    '',
                    'After reading, output:',
                    '- Your understanding of the goal (1-2 sentences)',
                    '- Completed / attempted steps (bullet list)',
                    '- Your proposed next steps (actionable checklist)',
                    '',
                    '※ If you do not have the edo-tensei skill, or cannot read local files, let me know and I will switch to full embedded context.',
                ].join('\n');
        }
    }

    private buildPathHandoffPrompt(session: CapturedSession, lang: string, guide: string, skillFound = false): string {
        if (skillFound) {
            return this.buildSkillInvocationPrompt(session, lang, guide);
        }
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
                introText = [
                    `你正在接手一個既有任務（來自 ${session.sourceIde}）。`,
                    '',
                    '1) 請先閱讀以下內嵌的對話歷史。',
                    '2) 讀完後請輸出：',
                    '- 你理解的目標（1-2 句）',
                    '- 已完成 / 已嘗試（條列）',
                    '- 你要採取的下一步（可執行清單）',
                    '',
                    '以下為對話歷史：'
                ].join('\n');
                break;
            case 'Simplified Chinese':
                introText = [
                    `你正在接手一个既有任务（来自 ${session.sourceIde}）。`,
                    '',
                    '1) 请先阅读以下内嵌的对话历史。',
                    '2) 读完后请输出：',
                    '- 你理解的目标（1-2 句）',
                    '- 已完成 / 已尝试（列表）',
                    '- 你要采取的下一步（可执行清单）',
                    '',
                    '以下为对话历史：'
                ].join('\n');
                break;
            case 'Japanese':
                introText = [
                    `あなたは既存のタスク（${session.sourceIde} から）を引き継ぎます。`,
                    '',
                    '1) 以下の会話履歴を読んでください。',
                    '2) 読了後に出力してください：',
                    '- あなたが理解した目標（1〜2文）',
                    '- 完了済み / 試行済みの内容（箇条書き）',
                    '- 次に取るべき行動（実行可能なチェックリスト）',
                    '',
                    '会話履歴：'
                ].join('\n');
                break;
            case 'Korean':
                introText = [
                    `당신은 기존 작업(${session.sourceIde}에서 이어받음)을 인계받고 있습니다.`,
                    '',
                    '1) 아래 내장된 대화 기록을 읽어 주세요.',
                    '2) 읽은 뒤 다음을 출력해 주세요:',
                    '- 당신이 이해한 목표 (1~2문장)',
                    '- 완료됨 / 시도됨 항목 (불릿 목록)',
                    '- 다음에 취할 단계 (실행 가능한 체크리스트)',
                    '',
                    '대화 기록:'
                ].join('\n');
                break;
            default:
                introText = [
                    `You are taking over an existing task (from ${session.sourceIde}).`,
                    '',
                    '1) Read the following conversation history.',
                    '2) After reading, output:',
                    '- Your understanding of the goal (1-2 sentences)',
                    '- Completed / attempted steps (bullet list)',
                    '- Your proposed next steps (actionable checklist)',
                    '',
                    'Conversation history:'
                ].join('\n');
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

    /**
     * Returns the default scan paths for each supported IDE on the current platform.
     * Used to show diagnostic information when no sessions are found.
     */
    public getExpectedScanPaths(): Array<{ ide: string; paths: string[] }> {
        const home = os.homedir();
        const appData = process.env.APPDATA ?? '';
        const isWin = process.platform === 'win32';

        return [
            {
                ide: 'Claude Code',
                paths: [path.join(home, '.claude', 'projects')],
            },
            {
                ide: 'GitHub Copilot',
                paths: isWin
                    ? [
                        path.join(appData, 'Code', 'User', 'globalStorage', 'emptyWindowChatSessions'),
                        path.join(appData, 'Code', 'User', 'workspaceStorage'),
                      ]
                    : [
                        path.join(home, '.config', 'Code', 'User', 'globalStorage', 'emptyWindowChatSessions'),
                        path.join(home, '.vscode-server', 'data', 'User', 'globalStorage', 'emptyWindowChatSessions'),
                      ],
            },
            {
                ide: 'Cursor',
                paths: isWin
                    ? [path.join(appData, 'Cursor', 'User', 'workspaceStorage')]
                    : [path.join(home, '.config', 'Cursor', 'User', 'workspaceStorage')],
            },
            {
                ide: 'Kiro',
                paths: isWin
                    ? [path.join(appData, 'Kiro', 'User', 'globalStorage', 'kiro.kiroagent')]
                    : [path.join(home, '.config', 'Kiro', 'User', 'globalStorage', 'kiro.kiroagent')],
            },
            {
                ide: 'Windsurf',
                paths: [path.join(home, '.codeium', 'windsurf', 'cascade')],
            },
            {
                ide: 'Codex CLI',
                paths: [path.join(home, '.codex', 'sessions')],
            },
            {
                ide: 'Gemini Code Assist',
                paths: [path.join(home, '.gemini', 'antigravity', 'brain')],
            },
        ];
    }

    /**
     * Lazily load the full message content for a session if the extractor supports it.
     */
    public async ensureSessionMessagesLoaded(session: CapturedSession): Promise<void> {
        if (session.messagesLoaded) {
            return;
        }
        
        const extractor = this.extractors.find(e => e.ideId === session.sourceIde);
        if (extractor && extractor.loadFullMessages) {
            try {
                await extractor.loadFullMessages(session);
            } catch (err) {
                console.error(`[SessionHandoffService] Error lazy-loading messages for ${session.sourceIde}:`, err);
            }
        }
        
        // Mark as loaded so we don't attempt to load again, even if it failed or had no full messages.
        session.messagesLoaded = true;
    }
}

