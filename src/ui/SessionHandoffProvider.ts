import * as vscode from 'vscode';
import * as path from 'path';
import { SessionHandoffService } from '../core/SessionHandoffService';
import { CapturedSession } from '../core/extractors/types';
import { I18n } from '../i18n';

function isLazyLoadEnabled(): boolean {
    try {
        return vscode.workspace.getConfiguration('edoTensei').get<boolean>('lazyLoadMessages', true);
    } catch { return true; }
}

/** 估算訊息列表的 token 數（字元數 ÷ 3.5，適用中英混合內容），超過 1000 用 k 縮寫 */
function estimateTokenLabel(messages: import('../core/extractors/types').ChatMessage[]): string {
    let charCount = 0;
    for (const msg of messages) {
        if (msg.content) { charCount += msg.content.length; }
        if (msg.thought) { charCount += msg.thought.length; }
    }
    const tokens = Math.round(charCount / 3.5);
    return tokens >= 1000 ? `~${(tokens / 1000).toFixed(1)}k` : `~${tokens}`;
}

/**
 * 從檔案大小估算 token 數。
 * 對 JSONL/JSON 格式：JSON overhead 約佔 40%，有效文字壓縮比約 0.6，再除以 3.5 char/token。
 * 等效換算：bytes * 0.6 / 3.5 ≈ bytes / 5.8
 * 對比實測誤差在 50% 以內，足以作 tooltip hint 使用。
 */
function estimateTokenLabelFromSize(fileSizeBytes: number): string {
    const tokens = Math.round(fileSizeBytes / 5.8);
    return tokens >= 1000 ? `~${(tokens / 1000).toFixed(1)}k` : `~${tokens}`;
}

/** 從 session 取得 project 名稱，若無則回傳 undefined */
function resolveProjectName(session: CapturedSession): string | undefined {
    if (session.workspacePath) {
        let name = path.basename(session.workspacePath);
        
        // Cursor 專案名稱清理 (例如: c-Users-username-Projects-MyProject -> MyProject)
        if (session.sourceIde === 'cursor' && name.includes('-')) {
            const parts = name.split('-');
            name = parts[parts.length - 1];
        }

        // 避免拿到 hash 或過短/過長的無意義名稱
        if (name && name.length > 2 && name.length < 50 && !/^[0-9a-f]{8,}$/.test(name)) {
            return name;
        }
    }
    // 不回退到 rawPath：無法判斷時直接回傳 undefined，讓 Session 掛在 IDE 節點下
    return undefined;
}

// ── TreeItem 定義 ───────────────────────────────────────────────────────────

export class IDEParentItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly ideId: string,
        public readonly sessionCount: number,
        public readonly statusText?: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'ideParentItem';
        this.description = statusText ?? I18n.getMessage('tree.sessionCount', String(sessionCount));

        const iconMap: Record<string, string> = {
            'cursor': 'account',
            'copilot': 'github-inverted',
            'windsurf': 'cloud',
            'antigravity': 'rocket',
            'kiro': 'zap',
            'trae': 'beaker',
            'claude': 'robot',          // Claude Code CLI（'sparkle' 在某些版本無法顯示，改用 robot）
            'codex': 'terminal-bash',   // OpenAI Codex CLI
        };
        this.iconPath = new vscode.ThemeIcon(iconMap[ideId] || 'folder');
    }
}

export class ProjectParentItem extends vscode.TreeItem {
    constructor(
        public readonly projectName: string,
        public readonly ideId: string,
        public readonly sessions: CapturedSession[]
    ) {
        super(projectName, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'projectParentItem';
        this.description = I18n.getMessage('tree.sessionCount', String(sessions.length));
        this.iconPath = new vscode.ThemeIcon('folder-library');
    }
}

export class SessionItem extends vscode.TreeItem {
    constructor(
        public readonly session: CapturedSession,
        /** 若 session 直接掛在 IDE 下（沒有 project 層），則在 label 顯示 project 名作 fallback */
        showProject = false
    ) {
        const date = new Date(session.capturedAt);
        const timeLabel = date.toLocaleString([], {
            month: 'numeric', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        // 智慧標題邏輯：有自訂標題 > 遍歷訊息找第一個有意義的 user 輸入 > Untitled
        let displayTitle = session.title;
        if (!displayTitle) {
            displayTitle = SessionHandoffProvider.extractMeaningfulTitle(session.messages);
        }

        super(displayTitle, vscode.TreeItemCollapsibleState.None);

        // description：若直接掛 IDE 下且有專案名稱則顯示 "專案 • 時間"，否則只顯示 "時間"
        if (showProject) {
            const pName = resolveProjectName(session);
            this.description = pName ? `${pName} • ${timeLabel}` : timeLabel;
        } else {
            this.description = timeLabel;
        }

        const projectName = showProject ? resolveProjectName(session) : (session.workspacePath ? path.basename(session.workspacePath) : 'Unknown Workspace');
        const truncatedTitle = displayTitle.length > 50 ? displayTitle.substring(0, 50) + '...' : displayTitle;

        if (isLazyLoadEnabled() && session.messagesLoaded === false) {
            // Lazy mode: 優先用檔案大小估算 token，無需 hover
            const tokenLabel = session.fileSizeBytes
                ? estimateTokenLabelFromSize(session.fileSizeBytes)
                : '—';
            const msgCount = session.messages.length > 0
                ? `${session.messages.length}+`
                : '—';
                
            this.tooltip = [
                `📁 ${projectName || session.sourceIde}`,
                `🕒 ${date.toLocaleString()}`,
                `📝 ${truncatedTitle}`,
                `💬 ${msgCount} messages`,
                `⚡ ${tokenLabel} tokens (est.)`,
                `${session.rawPath}`
            ].join('\n');
        } else {
            const tokenLabel = estimateTokenLabel(session.messages);
            this.tooltip = [
                `📁 ${projectName || session.sourceIde}`,
                `🕒 ${date.toLocaleString()}`,
                `📝 ${truncatedTitle}`,
                `💬 ${session.messages.length} messages`,
                `⚡ ${tokenLabel} tokens (est.)`,
                `${session.rawPath}`
            ].join('\n');
        }
        this.iconPath = new vscode.ThemeIcon('comment-discussion');
        this.contextValue = 'sessionItem';

        // 預設點擊行為：查看已解析 Session（Markdown 預覽）
        this.command = {
            command: 'edoTensei.viewParsedSession',
            title: 'View Parsed Session',
            arguments: [this]
        };
    }
}

// ── Provider ────────────────────────────────────────────────────────────────

export class SessionHandoffProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private sessionService: SessionHandoffService) {
        this.sessionService.onDidUpdateSessions(() => this.refresh());
    }

    /**
     * 從訊息列表中提取有意義的標題。
     * 策略：遍歷所有 user/assistant 訊息，逐行尋找第一個不是路徑、不是純英文 XML 殘餘、
     * 且有實質內容的行（超過 5 個字元，且不是明顯的系統路徑格式）。
     */
    static extractMeaningfulTitle(messages: import('../core/extractors/types').ChatMessage[]): string {
        const normalizeTitle = (line: string): string | undefined => {
            const trimmed = line.trim().replace(/^[-*#\s]+/, '').trim();
            if (!trimmed) return undefined;
            const title = trimmed.substring(0, 45);
            return trimmed.length > 45 ? title + '...' : title;
        };

        const extractContextTransferTitle = (content: string): string | undefined => {
            if (!/^CONTEXT TRANSFER:/i.test(content.trimStart())) return undefined;

            const matches = [...content.matchAll(/##\s*TASK\s+\d+\s*:\s*(.+?)\s*\n[\s\S]*?\*\*STATUS\*\*:\s*([^\n]+)/gi)];
            if (matches.length === 0) return undefined;

            const preferred = matches.find((m) => /in-progress/i.test(m[2])) ?? matches[0];
            return normalizeTitle(preferred[1]);
        };

        const stripKnownKiroWrappers = (content: string): string => {
            return content
                .replace(/^#\s*System Prompt\s*/i, '')
                .replace(/^##\s*Included Rules[\s\S]*?<\/user-rule>\s*/i, '')
                .replace(/\s*<EnvironmentContext>[\s\S]*?<\/EnvironmentContext>\s*$/i, '')
                .replace(/\s*<OPEN-EDITOR-FILES>[\s\S]*?<\/OPEN-EDITOR-FILES>\s*/gi, '')
                .replace(/\s*<ACTIVE-EDITOR-FILE>[\s\S]*?<\/ACTIVE-EDITOR-FILE>\s*/gi, '')
                .trim();
        };

        // 過濾器：判斷一行是否「有意義」（不是路徑、不是純符號、長度合適）
        const isPathLike = (line: string) =>
            /^([a-zA-Z]:[/\\]|\/[a-z])/i.test(line) ||  // Windows/Unix 絕對路徑
            /^[0-9a-f]{8,}$/i.test(line);               // 雜湊字串

        const isBoilerplateLine = (line: string) =>
            /^CONTEXT TRANSFER:/i.test(line) ||
            /^##\s*Included Rules\b/i.test(line) ||
            /^#\s*System Prompt\b/i.test(line) ||
            /^\*\*STATUS\*\*:/i.test(line) ||
            /^\*\*USER QUERIES\*\*:/i.test(line) ||
            /^\*\*DETAILS\*\*:/i.test(line) ||
            /^\*\*FILEPATHS\*\*:/i.test(line) ||
            /^\*\*NEXT STEPS\*\*:/i.test(line) ||
            /^I am providing you some additional guidance/i.test(line) ||
            /^They have been automatically suggested by the system/i.test(line) ||
            /^Workspace-level rules take precedence/i.test(line);

        for (const msg of messages) {
            if (msg.role !== 'user' && msg.role !== 'assistant') continue;
            if (!msg.content) continue;

            const rawContent = stripKnownKiroWrappers(msg.content);
            const contextTransferTitle = extractContextTransferTitle(rawContent);
            if (contextTransferTitle) return contextTransferTitle;

            const taskTitleMatch = rawContent.match(/<task title="([^"]+)"/i);
            if (taskTitleMatch?.[1]) {
                const title = normalizeTitle(taskTitleMatch[1]);
                if (title) return title;
            }

            const issueReplyMatch = rawContent.match(/這個issue如何回覆\?.*?\/issues\/(\d+)/i);
            if (issueReplyMatch?.[1]) {
                return `GitHub issue #${issueReplyMatch[1]} 回覆建議`;
            }

            // 以字元層級移除尖括號，避免多字元樣式清理造成標籤殘留（例如可重組為 <script>）
            const stripped = rawContent
                .replace(/[<>]/g, '')
                .trim();

            if (!stripped) continue;

            const lines = stripped.split('\n').map(l => l.trim()).filter(l => l.length > 4);
            for (const line of lines) {
                if (isPathLike(line)) continue;
                if (isBoilerplateLine(line)) continue;

                const taskHeadingMatch = line.match(/^##\s*TASK\s+\d+\s*:\s*(.+)$/i);
                if (taskHeadingMatch?.[1]) {
                    const title = normalizeTitle(taskHeadingMatch[1]);
                    if (title) return title;
                }

                const title = normalizeTitle(line);
                if (title) return title;
            }
        }

        return I18n.getMessage('session.untitled');
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Called by VS Code when the user hovers over a tree item.
     * In lazy mode, triggers full message load and updates the tooltip with real counts.
     */
    async resolveTreeItem(item: vscode.TreeItem, element: vscode.TreeItem): Promise<vscode.TreeItem> {
        if (!(element instanceof SessionItem) || !isLazyLoadEnabled()) {
            return item;
        }
        const session = element.session;
        await this.sessionService.ensureSessionMessagesLoaded(session);

        const date = new Date(session.capturedAt);
        const tokenLabel = estimateTokenLabel(session.messages);
        item.tooltip = [
            `Source: ${session.sourceIde}`,
            `Project: ${session.workspacePath || 'Unknown'}`,
            `Last Edit: ${date.toLocaleString()}`,
            `Messages: ${session.messages.length}  •  ${tokenLabel} tokens (est.)`,
            `Path: ${session.rawPath}`,
        ].join('\n');
        return item;
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {

        // ── 根節點：IDE 列表 ──────────────────────────────────────────────────
        if (!element) {
            const grouped = this.sessionService.getGroupedSessions();
            const items: IDEParentItem[] = [];

            const isScanning = this.sessionService.isScanning();
            const statusMap = this.sessionService.getIdeScanStatus();

            const ideIds: CapturedSession['sourceIde'][] = isScanning
                ? this.sessionService.getKnownIdeIds()
                : [...grouped.keys()] as CapturedSession['sourceIde'][];

            for (const ideId of ideIds) {
                const sessions = grouped.get(ideId) || [];

                // 非掃描中：只有當真的有 session 時才顯示該 IDE 資料夾
                if (!isScanning && sessions.length === 0) {
                    continue;
                }

                const label = ideId.charAt(0).toUpperCase() + ideId.slice(1);
                const status = statusMap.get(ideId);
                const statusText = isScanning
                    ? `${status?.state ?? 'scanning'} • ${status?.found ?? 0}`
                    : undefined;

                items.push(new IDEParentItem(label, ideId, sessions.length, statusText));
            }
            return items;
        }

        // ── IDE 節點：分 project 或直接列 session ────────────────────────────
        if (element instanceof IDEParentItem) {
            const grouped = this.sessionService.getGroupedSessions();
            const sessions = grouped.get(element.ideId) || [];

            // 依 project 名稱分群
            const withProject = new Map<string, CapturedSession[]>();
            const noProject: CapturedSession[] = [];

            for (const s of sessions) {
                const pName = resolveProjectName(s);
                if (pName) {
                    const list = withProject.get(pName) ?? [];
                    list.push(s);
                    withProject.set(pName, list);
                } else {
                    noProject.push(s);
                }
            }

            const children: vscode.TreeItem[] = [];

            // 依 project 內最新 session 的時間進行排序（最新的在最上面）
            const sortedProjects = [...withProject.entries()].sort(([, aSessions], [, bSessions]) => {
                const aMaxTime = Math.max(...aSessions.map(s => new Date(s.capturedAt).getTime()));
                const bMaxTime = Math.max(...bSessions.map(s => new Date(s.capturedAt).getTime()));
                return bMaxTime - aMaxTime;
            });

            // 有 project 的 → ProjectParentItem
            for (const [pName, pSessions] of sortedProjects) {
                children.push(new ProjectParentItem(pName, element.ideId, pSessions));
            }

            // 沒有 project 的 → 直接掛 SessionItem（description 顯示 project 作 hint）
            for (const s of noProject) {
                children.push(new SessionItem(s, /* showProject */ false));
            }

            return children;
        }

        // ── Project 節點：列 session ──────────────────────────────────────────
        if (element instanceof ProjectParentItem) {
            return element.sessions.map(s => new SessionItem(s, false));
        }

        return [];
    }
}
