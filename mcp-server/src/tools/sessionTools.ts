/**
 * Session management tools for MCP server
 *
 * Note: This is a standalone implementation for the MCP server.
 * The extractors from the main extension need to be refactored to remove vscode dependency
 * before they can be fully integrated here.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ErrorType, SessionSummary, IdeSourceInfo, ToolResponse } from '../types.js';
import { createSuccess, createError, createNotFoundError, createInvalidParamsError } from '../utils/ResponseFactory.js';
import { Logger } from '../utils/Logger.js';

// IDE 來源定義
const IDE_SOURCES: Array<{ id: string; displayName: string; defaultPaths: string[] }> = [
  {
    id: 'copilot',
    displayName: 'GitHub Copilot Chat',
    defaultPaths: process.platform === 'win32'
      ? [path.join(process.env.APPDATA || '', 'Code', 'User', 'globalStorage', 'emptyWindowChatSessions')]
      : [
          path.join(os.homedir(), '.config', 'Code', 'User', 'globalStorage', 'emptyWindowChatSessions'),
          path.join(os.homedir(), '.vscode-server', 'data', 'User', 'globalStorage', 'emptyWindowChatSessions'),
        ]
  },
  {
    id: 'cursor',
    displayName: 'Cursor',
    defaultPaths: [path.join(os.homedir(), '.cursor', 'projects')]
  },
  {
    id: 'claude',
    displayName: 'Claude Code',
    defaultPaths: [path.join(os.homedir(), '.claude', 'projects')]
  },
  {
    id: 'kiro',
    displayName: 'Kiro',
    defaultPaths: process.platform === 'win32'
      ? [path.join(process.env.APPDATA || '', 'Kiro', 'User', 'globalStorage', 'kiroagent')]
      : [path.join(os.homedir(), '.config', 'Kiro', 'User', 'globalStorage', 'kiroagent')]
  },
  {
    id: 'windsurf',
    displayName: 'Windsurf',
    defaultPaths: process.platform === 'win32'
      ? [path.join(process.env.APPDATA || '', 'Windsurf', 'User', 'globalStorage', 'chatSessions')]
      : [path.join(os.homedir(), '.config', 'Windsurf', 'User', 'globalStorage', 'chatSessions')]
  },
  {
    id: 'trae',
    displayName: 'Trae',
    defaultPaths: process.platform === 'win32'
      ? [path.join(process.env.APPDATA || '', 'Trae', 'User', 'globalStorage', 'chatSessions')]
      : [path.join(os.homedir(), '.config', 'Trae', 'User', 'globalStorage', 'chatSessions')]
  },
  {
    id: 'antigravity',
    displayName: 'Antigravity',
    defaultPaths: [path.join(os.homedir(), '.gemini', 'antigravity', 'brain')]
  },
  {
    id: 'codex',
    displayName: 'OpenAI Codex CLI',
    defaultPaths: [path.join(os.homedir(), '.codex')]
  },
];

export class SessionTools {
  private workspaceRoot: string | undefined;
  private customScanPaths: Record<string, string[]> = {};

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot;
  }

  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
  }

  setCustomScanPaths(paths: Record<string, string[]>): void {
    this.customScanPaths = paths;
  }

  /**
   * 列出所有支援的 IDE 來源及其狀態
   */
  async listIdeSources(): Promise<ToolResponse<{ sources: IdeSourceInfo[] }>> {
    try {
      const sources: IdeSourceInfo[] = [];

      for (const ide of IDE_SOURCES) {
        const scanPaths = this.getScanPaths(ide.id, ide.defaultPaths);
        let isAvailable = false;
        let sessionCount = 0;

        for (const scanPath of scanPaths) {
          try {
            if (fsSync.existsSync(scanPath)) {
              isAvailable = true;
              // 粗略計算檔案數量
              const stats = await this.countSessionFiles(scanPath, ide.id);
              sessionCount += stats;
            }
          } catch {
            // ignore
          }
        }

        sources.push({
          ide: ide.id,
          displayName: ide.displayName,
          isAvailable,
          scanPath: scanPaths,
          sessionCount
        });
      }

      return createSuccess({ sources });
    } catch (error) {
      Logger.logError('listIdeSources', error);
      return createError(ErrorType.INTERNAL_ERROR, `Failed to list IDE sources: ${error}`);
    }
  }

  /**
   * 掃描所有 sessions
   */
  async scanAllSessions(): Promise<ToolResponse<{ sessions: SessionSummary[]; total: number; byIde: Record<string, number> }>> {
    try {
      Logger.info('Starting scan of all sessions...');

      const allSessions: SessionSummary[] = [];
      const byIde: Record<string, number> = {};

      for (const ide of IDE_SOURCES) {
        try {
          const sessions = await this.scanIdeSessions(ide.id);
          allSessions.push(...sessions);
          byIde[ide.id] = sessions.length;
        } catch (error) {
          Logger.warning(`Failed to scan ${ide.id}: ${error}`);
          byIde[ide.id] = 0;
        }
      }

      // 依 capturedAt 排序 (最新的在前)
      allSessions.sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());

      Logger.info(`Scan complete. Found ${allSessions.length} sessions`);

      return createSuccess({
        sessions: allSessions,
        total: allSessions.length,
        byIde
      });
    } catch (error) {
      Logger.logError('scanAllSessions', error);
      return createError(ErrorType.INTERNAL_ERROR, `Failed to scan sessions: ${error}`);
    }
  }

  /**
   * 掃描特定專案的 sessions
   */
  async scanProjectSessions(args: { workspacePath: string }): Promise<ToolResponse<{ sessions: SessionSummary[]; total: number }>> {
    try {
      const { workspacePath } = args;

      if (!workspacePath) {
        return createInvalidParamsError('workspacePath is required');
      }

      if (!fsSync.existsSync(workspacePath)) {
        return createError(ErrorType.NOT_FOUND, `Workspace path does not exist: ${workspacePath}`);
      }

      Logger.info(`Scanning project sessions for: ${workspacePath}`);

      // 取得所有 sessions 後依 workspace 過濾
      const allResult = await this.scanAllSessions();
      if (!allResult.success) {
        return allResult;
      }

      const allSessions = allResult.data!.sessions;

      // 過濾與指定 workspace 相關的 sessions
      // 策略：檢查 session.workspacePath 是否包含或匹配 workspacePath
      const normalizedTarget = path.normalize(workspacePath).toLowerCase();
      const projectSessions = allSessions.filter(session => {
        if (!session.workspacePath) return false;
        const normalizedSession = path.normalize(session.workspacePath).toLowerCase();
        return normalizedSession === normalizedTarget ||
               normalizedSession.startsWith(normalizedTarget + path.sep);
      });

      Logger.info(`Found ${projectSessions.length} project-specific sessions`);

      return createSuccess({
        sessions: projectSessions,
        total: projectSessions.length
      });
    } catch (error) {
      Logger.logError('scanProjectSessions', error);
      return createError(ErrorType.INTERNAL_ERROR, `Failed to scan project sessions: ${error}`);
    }
  }

  /**
   * 取得特定 session 詳情
   */
  async getSession(args: { sessionId: string }): Promise<ToolResponse<{ session: SessionSummary }>> {
    try {
      const { sessionId } = args;

      if (!sessionId) {
        return createInvalidParamsError('sessionId is required');
      }

      // 解析 composite id: "${ide}:${sessionId}"
      const [ide, ...idParts] = sessionId.split(':');
      const actualId = idParts.join(':');

      if (!ide || !actualId) {
        return createInvalidParamsError('Invalid sessionId format. Expected: "ide:sessionId"');
      }

      // 掃描該 IDE 的所有 sessions
      const sessions = await this.scanIdeSessions(ide);
      const session = sessions.find(s => s.id === sessionId);

      if (!session) {
        return createNotFoundError('Session', sessionId);
      }

      return createSuccess({ session });
    } catch (error) {
      Logger.logError('getSession', error);
      return createError(ErrorType.INTERNAL_ERROR, `Failed to get session: ${error}`);
    }
  }

  /**
   * 取得 session 的完整 messages
   * Note: 需要實際讀取原始檔案並解析
   */
  async getSessionMessages(args: { sessionId: string; maxMessages?: number }): Promise<ToolResponse<{ messages: any[]; totalMessages: number; truncated: boolean }>> {
    try {
      const { sessionId, maxMessages } = args;

      if (!sessionId) {
        return createInvalidParamsError('sessionId is required');
      }

      // 解析 composite id
      const [ide, ...idParts] = sessionId.split(':');
      const actualId = idParts.join(':');

      if (!ide || !actualId) {
        return createInvalidParamsError('Invalid sessionId format. Expected: "ide:sessionId"');
      }

      // TODO: 實際讀取並解析原始 session 檔案
      // 這需要整合 extractor 的具體實作
      // 目前回傳 placeholder

      Logger.info(`Loading messages for session: ${sessionId}`);

      // Placeholder: 實際整合 extractor 後會有完整實作
      return createSuccess({
        messages: [],
        totalMessages: 0,
        truncated: false
      });
    } catch (error) {
      Logger.logError('getSessionMessages', error);
      return createError(ErrorType.INTERNAL_ERROR, `Failed to get session messages: ${error}`);
    }
  }

  async searchSessions(args: {
    query?: string;
    regex?: string;
    time?: string;
    ide?: string;
    workspacePath?: string;
    limit?: number;
  }): Promise<ToolResponse<{ sessions: Array<SessionSummary & { score: number; matchedFields: string[]; snippets: string[] }>; total: number }>> {
    try {
      const allResult = await this.scanAllSessions();
      if (!allResult.success) {
        return allResult as any;
      }

      const limit = Math.max(1, args.limit ?? 30);
      const timeRange = this.parseTimeExpression(args.time);
      const matcher = this.createMatcher(args.query, args.regex);
      const workspace = args.workspacePath ? path.normalize(args.workspacePath).toLowerCase() : undefined;

      const results = allResult.data!.sessions
        .filter(s => !args.ide || s.ide === args.ide)
        .filter(s => this.matchesTime(s.capturedAt, timeRange))
        .filter(s => !workspace || this.matchesWorkspace(s.workspacePath, workspace))
        .map(s => this.scoreSummary(s, matcher))
        .filter(r => r.score > 0 || (!args.query && !args.regex))
        .sort((a, b) => b.score - a.score || new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime())
        .slice(0, limit);

      return createSuccess({ sessions: results, total: results.length });
    } catch (error) {
      Logger.logError('searchSessions', error);
      return createError(ErrorType.INTERNAL_ERROR, `Failed to search sessions: ${error}`);
    }
  }

  // Helper methods

  private getScanPaths(ideId: string, defaultPaths: string[]): string[] {
    const custom = this.customScanPaths[ideId] || [];
    return [...custom, ...defaultPaths];
  }

  private async countSessionFiles(scanPath: string, ideId: string): Promise<number> {
    try {
      const entries = await fs.readdir(scanPath, { withFileTypes: true });
      let count = 0;

      for (const entry of entries) {
        if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (ext === '.json' || ext === '.jsonl' || ext === '.chat' || ext === '.txt') {
            count++;
          }
        } else if (entry.isDirectory() && ideId === 'cursor') {
          // Cursor 有巢狀結構
          const subCount = await this.countSessionFiles(path.join(scanPath, entry.name), '');
          count += subCount;
        }
      }

      return count;
    } catch {
      return 0;
    }
  }

  private async scanIdeSessions(ideId: string): Promise<SessionSummary[]> {
    const ide = IDE_SOURCES.find(s => s.id === ideId);
    if (!ide) return [];

    const scanPaths = this.getScanPaths(ideId, ide.defaultPaths);
    const sessions: SessionSummary[] = [];

    for (const scanPath of scanPaths) {
      try {
        if (!fsSync.existsSync(scanPath)) continue;

        // TODO: 整合實際 extractor 進行檔案掃描與解析
        // 目前為架構示範，實際實作需要:
        // 1. 建立 MCP 版本的 extractors (去除 vscode 依賴)
        // 2. 呼叫 extractor.extractAll() 取得 sessions
        // 3. 轉換為 SessionSummary 格式

        // Placeholder: 掃描檔案並建立基本摘要
        const fileStats = await this.scanSessionFiles(scanPath, ideId);
        for (const stat of fileStats) {
          sessions.push({
            id: `${ideId}:${stat.name}`,
            ide: ideId,
            title: stat.name,
            capturedAt: stat.mtime,
            messageCount: 0, // TODO: 實際解析後填入
            fileSizeBytes: stat.size,
            rawPath: stat.path,
            status: 'success'
          });
        }
      } catch (error) {
        Logger.warning(`Failed to scan ${ideId} at ${scanPath}: ${error}`);
      }
    }

    return sessions;
  }

  private async scanSessionFiles(scanPath: string, ideId: string): Promise<Array<{ name: string; size: number; mtime: string; path: string }>> {
    const results: Array<{ name: string; size: number; mtime: string; path: string }> = [];

    try {
      const entries = await fs.readdir(scanPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (['.json', '.jsonl', '.chat', '.txt'].includes(ext)) {
            const fullPath = path.join(scanPath, entry.name);
            const stat = await fs.stat(fullPath);
            results.push({
              name: entry.name,
              size: stat.size,
              mtime: stat.mtime.toISOString(),
              path: fullPath
            });
          }
        } else if (entry.isDirectory() && ideId === 'cursor') {
          // 遞迴掃描 Cursor 的巢狀結構
          const subPath = path.join(scanPath, entry.name);
          const subResults = await this.scanSessionFiles(subPath, '');
          results.push(...subResults.map(r => ({ ...r, name: `${entry.name}/${r.name}` })));
        }
      }
    } catch {
      // ignore
    }

    return results;
  }

  private createMatcher(query?: string, regex?: string): ((text: string) => boolean) | undefined {
    if (regex) {
      try {
        const re = new RegExp(regex, 'i');
        return text => re.test(text);
      } catch {
        return () => false;
      }
    }

    const terms = query?.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms?.length) return undefined;
    return text => {
      const lower = text.toLowerCase();
      return terms.every(term => lower.includes(term));
    };
  }

  private scoreSummary(session: SessionSummary, matcher: ((text: string) => boolean) | undefined): SessionSummary & { score: number; matchedFields: string[]; snippets: string[] } {
    if (!matcher) {
      return { ...session, score: 1, matchedFields: ['time'], snippets: [] };
    }

    let score = 0;
    const matchedFields: string[] = [];
    const snippets: string[] = [];
    const fields: Array<[string, string | undefined, number]> = [
      ['title', session.title, 8],
      ['workspacePath', session.workspacePath, 5],
      ['rawPath', session.rawPath, 3],
      ['id', session.id, 2],
      ['ide', session.ide, 1],
    ];

    for (const [field, value, weight] of fields) {
      if (value && matcher(value)) {
        score += weight;
        matchedFields.push(field);
        snippets.push(`${field}: ${value}`);
      }
    }

    return { ...session, score, matchedFields, snippets: snippets.slice(0, 5) };
  }

  private matchesWorkspace(sessionWorkspace: string | undefined, workspace: string): boolean {
    if (!sessionWorkspace) return false;
    const normalized = path.normalize(sessionWorkspace).toLowerCase();
    return normalized === workspace || normalized.startsWith(workspace + path.sep) || workspace.startsWith(normalized + path.sep);
  }

  private matchesTime(capturedAt: string, range?: { start?: Date; end?: Date }): boolean {
    if (!range) return true;
    const time = new Date(capturedAt).getTime();
    if (Number.isNaN(time)) return false;
    if (range.start && time < range.start.getTime()) return false;
    if (range.end && time > range.end.getTime()) return false;
    return true;
  }

  private parseTimeExpression(input?: string): { start?: Date; end?: Date } | undefined {
    const text = input?.trim();
    if (!text) return undefined;
    const now = new Date();
    const lower = text.toLowerCase();

    if (lower === 'today' || text === '今天') {
      return { start: this.startOfDay(now), end: now };
    }
    if (lower === 'yesterday' || text === '昨天') {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return { start: this.startOfDay(yesterday), end: this.endOfDay(yesterday) };
    }
    if (lower === 'this week' || text === '本週' || text === '这周') {
      const start = this.startOfDay(now);
      start.setDate(start.getDate() - start.getDay());
      return { start, end: now };
    }

    const recent = text.match(/^(?:recent|last|最近)\s*(\d+)\s*(day|days|天|日)$/i);
    if (recent) {
      const start = new Date(now);
      start.setDate(start.getDate() - Number(recent[1]));
      return { start, end: now };
    }

    const range = text.match(/^(\d{4}[-/]\d{1,2}[-/]\d{1,2})\s*(?:to|~|-|到|至)\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})$/i);
    if (range) {
      const start = this.parseDate(range[1]);
      const end = this.parseDate(range[2]);
      if (start && end) return { start: this.startOfDay(start), end: this.endOfDay(end) };
    }

    const date = this.parseDate(text);
    return date ? { start: this.startOfDay(date), end: this.endOfDay(date) } : undefined;
  }

  private parseDate(input: string): Date | undefined {
    const date = new Date(`${input.replace(/\//g, '-')}T00:00:00`);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  private startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  }

  private endOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  }
}
