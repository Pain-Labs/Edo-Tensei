/**
 * KiroExtractor.ts
 *
 * 讀取 Kiro 的對話記錄。支援兩種會話格式：
 *
 * ── 格式 A（舊版，.chat 檔）──────────────────────────────────────
 * 儲存路徑：%APPDATA%\Kiro\User\globalStorage\kiro.kiroagent\<hash>\*.chat
 * JSON 結構：{ "chat": [{ "role": "user"|"bot", "content": "..." }] }
 * ⚠️ 無 workspacePath 資訊，無法進行專案過濾（已確認）。
 *
 * ── 格式 B（新版，workspace-sessions）────────────────────────────
 * 儲存路徑：%APPDATA%\Kiro\User\globalStorage\kiro.kiroagent\workspace-sessions\
 *           <Base64URL(絕對路徑)>\<session-uuid>.json
 *
 * JSON 頂層欄位直接含 `workspaceDirectory`（字串，真實絕對路徑），
 * 無需依賴資料夾名稱的 Base64URL 解碼（但兩者均可使用）。
 *
 * JSON 結構：{
 *   "workspaceDirectory": "c:\\Users\\username\\Projects\\my-project",
 *   "history": [{
 *     "message": { "role": "user"|"assistant", "content": [{ "type": "text", "text": "..." }] | "string" }
 *   }]
 * }
 *
 * ⚠️ Kiro Agent 模式說明（已確認）：
 *   助理回覆文字通常僅為 "On it."（acknowledgement），
 *   真正的工具執行結果儲存於 executionId 指向的 agentic 流程，
 *   本地 JSON 並不含詳細的 AI 文字回應。這是 Kiro 的設計，非解析錯誤。
 *   因此 session 的交接價值主要來自完整的「使用者訊息串」。
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { CapturedSession, ChatMessage, IChatExtractor } from './types';
import { PathInference } from '../PathInference';

// ── 型別定義 ─────────────────────────────────────────────────────

/** 舊版 .chat 格式 */
interface KiroChatFile {
  chat?: Array<{
    role?: string;
    content?: string;
  }>;
}

/** 新版 workspace-sessions JSON 格式 */
interface KiroWorkspaceSession {
  /** 直接存放真實工作區路徑，無需 Base64 解碼 */
  workspaceDirectory?: string;
  history?: Array<{
    executionId?: string;
    message?: {
      role?: string;
      /** 新版 content 為 ContentPart[] 或純字串（agent 回覆） */
      content?: Array<{ type?: string; text?: string }> | string;
    };
  }>;
}

// ── Extractor ────────────────────────────────────────────────────

export class KiroExtractor implements IChatExtractor {
  readonly ideId = 'kiro' as const;

  /** 回傳所有可能的 kiro.kiroagent 根目錄 */
  private getKiroAgentDirs(): string[] {
    const dirs: string[] = [];
    const home = os.homedir();
    if (process.platform === 'win32') {
      const appData = process.env.APPDATA;
      if (appData) {
        dirs.push(path.join(appData, 'Kiro', 'User', 'globalStorage', 'kiro.kiroagent'));
      }
    } else if (process.platform === 'darwin') {
      dirs.push(path.join(home, 'Library', 'Application Support', 'Kiro', 'User', 'globalStorage', 'kiro.kiroagent'));
    } else {
      dirs.push(path.join(home, '.config', 'Kiro', 'User', 'globalStorage', 'kiro.kiroagent'));
    }
    return dirs;
  }

  /** @deprecated use getKiroAgentDirs() */
  private getProjectsDir(): string {
    return this.getKiroAgentDirs()[0] ?? '';
  }

  private isLazyEnabled(): boolean {
    try {
      return vscode.workspace.getConfiguration('edoTensei').get<boolean>('lazyLoadMessages', true);
    } catch {
      return true;
    }
  }

  private async safeReadFile(p: string): Promise<string | undefined> {
    try { return await fs.readFile(p, 'utf8'); } catch { return undefined; }
  }

  // ── 公開 API ──────────────────────────────────────────────────

  async extract(workspacePath?: string, customScanPaths: string[] = []): Promise<CapturedSession> {
    const sessions = await this.extractAll(workspacePath, customScanPaths);
    return sessions.length > 0
      ? sessions[0]
      : { sourceIde: this.ideId, capturedAt: new Date().toISOString(), messages: [], rawPath: this.getProjectsDir(), readStatus: 'empty' };
  }

  async extractAll(workspacePath?: string, customScanPaths: string[] = []): Promise<CapturedSession[]> {
    const kiroAgentDirs = this.getKiroAgentDirs();
    const results: CapturedSession[] = [];

    const rootDirs = [...customScanPaths, ...kiroAgentDirs];

    for (const rootDir of rootDirs) {
      // 格式 B：workspace-sessions（優先，有 workspacePath 映射）
      const wsSessionsDir = path.join(rootDir, 'workspace-sessions');
      const formatBResults = await this.extractWorkspaceSessions(wsSessionsDir, workspacePath);
      results.push(...formatBResults);

      // 格式 A：舊版 .chat 檔案（根目錄下的 hash 資料夾）
      const formatAResults = await this.extractLegacyChatFiles(rootDir, workspacePath);
      results.push(...formatAResults);
    }

    return results.sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
  }

  // ── 格式 B：workspace-sessions ────────────────────────────────

  private async extractWorkspaceSessions(wsSessionsDir: string, workspacePath?: string): Promise<CapturedSession[]> {
    const results: CapturedSession[] = [];
    const lazy = this.isLazyEnabled();

    try {
      await fs.access(wsSessionsDir);
      const encodedFolders = await fs.readdir(wsSessionsDir);

      // Process all workspace folders in parallel
      const folderResults = await Promise.all(
        encodedFolders.map(async (encodedName): Promise<CapturedSession[]> => {
          const folderPath = path.join(wsSessionsDir, encodedName);
          try {
            const stat = await fs.stat(folderPath);
            if (!stat.isDirectory()) return [];

            const fallbackPath = this.decodeBase64UrlPath(encodedName);

            const files = await fs.readdir(folderPath);
            const sessionFiles = files.filter(f => f.endsWith('.json') && f !== 'sessions.json');

            // Process session files in parallel
            const fileResults = await Promise.all(
              sessionFiles.map(async (f): Promise<CapturedSession | undefined> => {
                const filePath = path.join(folderPath, f);
                try {
                  const fsStat = await fs.stat(filePath);
                  const raw = await fs.readFile(filePath, 'utf8');

                  if (lazy) {
                    const { firstMsg, workspaceDirectory } = this.parseFirstUserMessageFromWsSession(raw);
                    const resolvedWorkspacePath = workspaceDirectory ?? fallbackPath ?? undefined;

                    // Apply workspace filter
                    if (workspacePath && resolvedWorkspacePath &&
                        !resolvedWorkspacePath.toLowerCase().includes(workspacePath.toLowerCase()) &&
                        !workspacePath.toLowerCase().includes(resolvedWorkspacePath.toLowerCase())) {
                      return undefined;
                    }

                    return {
                      sourceIde: this.ideId,
                      capturedAt: new Date(fsStat.mtimeMs).toISOString(),
                      sessionId: f.replace('.json', ''),
                      messages: firstMsg ? [firstMsg] : [],
                      metadata: { lazyScanned: true },
                      messagesLoaded: false,
                      fileSizeBytes: fsStat.size,
                      rawPath: filePath,
                      workspacePath: resolvedWorkspacePath,
                      readStatus: 'success',
                    };
                  } else {
                    const { messages, workspaceDirectory, executionIds } = this.parseWorkspaceSessionJson(raw);
                    const resolvedWorkspacePath = workspaceDirectory ?? fallbackPath ?? undefined;
                    if (messages.length === 0) return undefined;
                    return {
                      sourceIde: this.ideId,
                      capturedAt: new Date(fsStat.mtimeMs).toISOString(),
                      sessionId: f.replace('.json', ''),
                      messages,
                      metadata: { executionIds },
                      messagesLoaded: false,
                      fileSizeBytes: fsStat.size,
                      rawPath: filePath,
                      workspacePath: resolvedWorkspacePath,
                      readStatus: 'success',
                    };
                  }
                } catch { return undefined; }
              })
            );

            return fileResults.filter((s): s is CapturedSession => s !== undefined);
          } catch { return []; }
        })
      );

      for (const sessions of folderResults) {
        results.push(...sessions);
      }
    } catch { /* workspace-sessions dir may not exist */ }

    return results;
  }

  private inferLegacyWorkspacePath(raw: string, messages: ChatMessage[], workspacePath?: string): { workspacePath?: string; metadata?: Record<string, any> } {
    const inferred = PathInference.inferWorkspacePath(messages, { candidateWorkspacePath: workspacePath });
    if (inferred.workspacePath) {
      return {
        workspacePath: inferred.workspacePath,
        metadata: {
          workspacePathSource: 'inferred',
          workspacePathConfidence: inferred.confidence,
          workspacePathReason: inferred.reason,
          workspacePathEvidence: inferred.evidence,
        },
      };
    }

    if (!workspacePath) {
      return {};
    }

    try {
      const obj = JSON.parse(raw) as any;
      const contextArr = Array.isArray(obj?.context) ? obj.context : [];
      const fileTreeText = contextArr
        .map((c: any) => typeof c?.staticDirectoryView === 'string' ? c.staticDirectoryView : '')
        .find((t: string) => t.includes('<fileTree>'));

      if (!fileTreeText) {
        return {};
      }

      const names = new Set<string>();
      for (const m of fileTreeText.matchAll(/<(?:folder|file)\s+name='([^']+)'/g)) {
        const name = m[1];
        if (!name || name.includes('/')) { continue; }
        names.add(name);
      }

      let hits = 0;
      for (const n of names) {
        try {
          if (fsSync.existsSync(path.join(workspacePath, n))) {
            hits++;
          }
        } catch {
          // ignore
        }
        if (hits >= 3) {
          return {
            workspacePath,
            metadata: {
              workspacePathSource: 'inferred',
              workspacePathConfidence: 0.8,
              workspacePathReason: 'legacy-file-tree-evidence',
            },
          };
        }
      }
    } catch {
      // ignore
    }

    return {};
  }

  private getLegacyExecutionId(raw: string): string | undefined {
    try {
      const obj = JSON.parse(raw) as any;
      const execId = obj?.executionId;
      return typeof execId === 'string' && execId.trim() ? execId.trim() : undefined;
    } catch {
      return undefined;
    }
  }

  private async extractLegacyChatFiles(rootDir: string, workspacePath?: string): Promise<CapturedSession[]> {
    const results: CapturedSession[] = [];
    try {
      await fs.access(rootDir);
      const folders = await fs.readdir(rootDir);
      const hexFolders = folders.filter(f => this.isHexHash(f));

      const folderResults = await Promise.all(
        hexFolders.map(async (folder): Promise<CapturedSession[]> => {
          const folderPath = path.join(rootDir, folder);
          try {
            const s = await fs.stat(folderPath);
            if (!s.isDirectory()) return [];

            const files = await fs.readdir(folderPath);
            const chatFiles = files.filter(f => f.endsWith('.chat'));

            const fileResults = await Promise.all(
              chatFiles.map(async (f): Promise<{ session?: CapturedSession; executionId?: string; mtimeMs: number; messageCount: number } | undefined> => {
                const filePath = path.join(folderPath, f);
                try {
                  const fsStat = await fs.stat(filePath);
                  const raw = await fs.readFile(filePath, 'utf8');

                  const messages = this.parseLegacyKiroChat(raw);
                  if (messages.length > 0) {
                    const executionId = this.getLegacyExecutionId(raw);
                    const inferredWorkspace = this.inferLegacyWorkspacePath(raw, messages, workspacePath);
                    if (workspacePath && !inferredWorkspace.workspacePath) {
                      return undefined;
                    }

                    const session: CapturedSession = {
                      sourceIde: this.ideId,
                      capturedAt: new Date(fsStat.mtimeMs).toISOString(),
                      sessionId: executionId ?? f.replace(/\.chat$/i, ''),
                      messages,
                      rawPath: filePath,
                      workspacePath: inferredWorkspace.workspacePath,
                      metadata: inferredWorkspace.metadata,
                      readStatus: 'success',
                    };

                    return {
                      session,
                      executionId,
                      mtimeMs: fsStat.mtimeMs,
                      messageCount: messages.length,
                    };
                  }
                } catch { /* skip */ }
                return undefined;
              })
            );

            const byExec = new Map<string, { session: CapturedSession; mtimeMs: number; messageCount: number }>();
            const withoutExec: CapturedSession[] = [];
            for (const r of fileResults) {
              if (!r?.session) { continue; }
              const key = r.executionId;
              if (!key) {
                withoutExec.push(r.session);
                continue;
              }
              const prev = byExec.get(key);
              if (!prev) {
                byExec.set(key, { session: r.session, mtimeMs: r.mtimeMs, messageCount: r.messageCount });
                continue;
              }
              const prefer =
                r.mtimeMs > prev.mtimeMs ||
                (r.mtimeMs === prev.mtimeMs && r.messageCount > prev.messageCount);
              if (prefer) {
                byExec.set(key, { session: r.session, mtimeMs: r.mtimeMs, messageCount: r.messageCount });
              }
            }

            return [...byExec.values()].map(v => v.session).concat(withoutExec);
          } catch { return []; }
        })
      );

      for (const sessions of folderResults) {
        results.push(...sessions);
      }
    } catch { /* rootDir inaccessible */ }

    return results;
  }

  /**
   * Lightweight pre-scan: parse only the first user message and workspaceDirectory.
   * Used during lazy extractAll() to avoid parsing the full history array.
   */
  private parseFirstUserMessageFromWsSession(raw: string): { firstMsg: ChatMessage | undefined; workspaceDirectory: string | null } {
    try {
      const obj = JSON.parse(raw) as KiroWorkspaceSession;
      const workspaceDirectory = typeof obj.workspaceDirectory === 'string' && obj.workspaceDirectory.trim()
        ? obj.workspaceDirectory.trim()
        : null;

      const history = obj.history;
      if (!Array.isArray(history)) return { firstMsg: undefined, workspaceDirectory };

      for (const entry of history) {
        const msg = entry.message;
        if (!msg || msg.role !== 'user') continue;

        let text = '';
        if (typeof msg.content === 'string') {
          text = msg.content.trim();
        } else if (Array.isArray(msg.content)) {
          text = msg.content
            .filter(part => part.type === 'text' && typeof part.text === 'string')
            .map(part => part.text!)
            .join('\n')
            .trim();
        }

        if (text) return { firstMsg: { role: 'user', content: text }, workspaceDirectory };
      }

      return { firstMsg: undefined, workspaceDirectory };
    } catch {
      return { firstMsg: undefined, workspaceDirectory: null };
    }
  }

  /**
   * 將 Kiro workspace-sessions 的 Base64URL 資料夾名稱解碼為絕對路徑（Fallback 用）。
   */
  private decodeBase64UrlPath(encodedName: string): string | null {
    try {
      const padded = encodedName + '='.repeat((4 - (encodedName.length % 4)) % 4);
      const decoded = Buffer.from(padded, 'base64url').toString('utf8');
      const clean = decoded.split('\x0f')[0].replace(/\?$/, '').trimEnd();
      return clean.length > 0 ? clean : null;
    } catch {
      return null;
    }
  }

  private parseWorkspaceSessionJson(raw: string): { messages: ChatMessage[]; workspaceDirectory: string | null; executionIds: string[] } {
    const messages: ChatMessage[] = [];
    const executionIds: string[] = [];
    let workspaceDirectory: string | null = null;

    try {
      const obj = JSON.parse(raw) as KiroWorkspaceSession & { history?: Array<{ executionId?: string }> };

      if (typeof obj.workspaceDirectory === 'string' && obj.workspaceDirectory.trim()) {
        workspaceDirectory = obj.workspaceDirectory.trim();
      }

      const history = obj.history;
      if (!Array.isArray(history)) return { messages, workspaceDirectory, executionIds };

      for (const entry of history) {
        const msg = entry.message;
        if (!msg || !msg.role) continue;

        let text = '';
        if (typeof msg.content === 'string') {
          text = msg.content.trim();
        } else if (Array.isArray(msg.content)) {
          text = msg.content
            .filter(part => part.type === 'text' && typeof part.text === 'string')
            .map(part => part.text!)
            .join('\n')
            .trim();
        }

        if (!text) continue;

        let role: ChatMessage['role'] = 'assistant';
        if (msg.role === 'user') role = 'user';
        else if (msg.role === 'assistant') role = 'assistant';

        messages.push({ role, content: text });

        if (entry.executionId) {
          executionIds.push(entry.executionId);
        } else {
          executionIds.push('');
        }
      }
    } catch { /* ignore parse error */ }

    return { messages, workspaceDirectory, executionIds };
  }

  // ── 格式 B：Lazy Load Graph Parser ───────────────────────────────

  async loadFullMessages(session: CapturedSession): Promise<void> {
    if (session.messagesLoaded) return;

    // Step 1: If lazy-scanned, re-parse full history from session JSON
    if (session.metadata?.lazyScanned) {
      const raw = await this.safeReadFile(session.rawPath);
      if (raw) {
        const { messages, executionIds } = this.parseWorkspaceSessionJson(raw);
        session.messages = messages;
        session.metadata = { ...session.metadata, executionIds, lazyScanned: false };
      }
    }

    const execIds: string[] = session.metadata?.executionIds ?? [];
    if (!execIds.length) return;

    // Step 2: Expand execution graphs for "On it." assistant messages
    const newMessages: ChatMessage[] = [];
    const rootDir = this.getKiroAgentDirs()[0];
    if (!rootDir) return;

    for (let i = 0; i < session.messages.length; i++) {
      const origMsg = session.messages[i];
      newMessages.push(origMsg);

      const execId = execIds[i];
      if (origMsg.role === 'assistant' && execId && origMsg.content.includes('On it.')) {
        const fullBotMsgs = await this.getFullMessagesForExecution(rootDir, execId);
        if (fullBotMsgs.length > 0) {
          newMessages.pop();
          newMessages.push(...fullBotMsgs);
        }
      }
    }

    session.messages = newMessages;
    session.messagesLoaded = true;
  }

  private async getFullMessagesForExecution(rootDir: string, execId: string): Promise<ChatMessage[]> {
    const data = await this.findExecutionData(rootDir, execId);
    if (!data) return [];

    if (Array.isArray(data.actions)) {
      for (const action of data.actions) {
        const subId = action.output?.executionId;
        if (subId) {
          const subData = await this.findExecutionData(rootDir, subId);
          if (subData?.graph?.context?.messages) {
            return this.parseGraphMessages(subData.graph.context.messages);
          }
        }
      }
    }

    if (Array.isArray(data.chat) || Array.isArray(data.context)) {
      return this.parseLegacyKiroChat(JSON.stringify(data));
    }

    if (data.graph?.context?.messages) {
      return this.parseGraphMessages(data.graph.context.messages);
    }

    return [];
  }

  private async findExecutionData(rootDir: string, targetId: string): Promise<any | null> {
    try {
      const folders = await fs.readdir(rootDir);
      for (const folder of folders) {
        if (!this.isHexHash(folder)) continue;

        const hpath = path.join(rootDir, folder);
        const subItems = await fs.readdir(hpath, { withFileTypes: true });

        for (const item of subItems) {
          const itemPath = path.join(hpath, item.name);
          if (item.isDirectory()) {
            const files = await fs.readdir(itemPath);
            for (const f of files) {
              const fpath = path.join(itemPath, f);
              const data = await this.readAndMatchExecution(fpath, targetId);
              if (data) return data;
            }
          } else {
            const data = await this.readAndMatchExecution(itemPath, targetId);
            if (data) return data;
          }
        }
      }
    } catch { /* ignore */ }
    return null;
  }

  private async readAndMatchExecution(fpath: string, targetId: string): Promise<any | null> {
    try {
      const content = await fs.readFile(fpath, 'utf8');
      if (content.includes(targetId)) {
        const data = JSON.parse(content);
        if (data.executionId === targetId) return data;
      }
    } catch { /* ignore */ }
    return null;
  }

  private parseGraphMessages(graphMessages: any[]): ChatMessage[] {
    const results: ChatMessage[] = [];
    if (!Array.isArray(graphMessages)) return results;

    for (const msg of graphMessages) {
      const role = msg.role === 'bot' || msg.role === 'assistant' ? 'assistant' : undefined;
      if (!role) continue;

      const entries = msg.entries;
      if (!Array.isArray(entries)) continue;

      let textContent = '';
      const tools: any[] = [];

      for (const entry of entries) {
        if (entry.type === 'text' && typeof entry.text === 'string') {
          if (entry.text.includes('<identity>')) continue;
          textContent += entry.text + '\n';
        } else if (entry.type === 'toolUse') {
          tools.push({ name: entry.name || entry.toolName, args: entry.input || entry.args });
        }
      }

      if (textContent.trim() || tools.length > 0) {
        results.push({
          role: 'assistant',
          content: textContent.trim(),
          toolCalls: tools.length > 0 ? tools : undefined
        });
      }
    }

    return results;
  }

  // ── 格式 A：舊版 .chat 檔案 ────────────────────────────────────

  private isHexHash(name: string): boolean {
    return /^[0-9a-f]{32}$/i.test(name);
  }

  private stripLeadingLegacyBlock(text: string, tagName: string): string {
    const pattern = new RegExp(`^<${tagName}[^>]*>[\\s\\S]*?<\\/${tagName}>\\s*`, 'i');
    return text.replace(pattern, '').trim();
  }

  private sanitizeLegacyKiroMessage(role: string, text: string): string {
    const original = text.trim();
    let cleaned = original;

    if (role === 'human' || role === 'user') {
      if (/^(#\s*System Prompt\b|<identity>)/i.test(cleaned)) {
        return '';
      }

      cleaned = cleaned.replace(/^#\s*System Prompt\s*/i, '').trim();

      for (const tagName of ['identity', 'capabilities']) {
        cleaned = this.stripLeadingLegacyBlock(cleaned, tagName);
      }

      cleaned = cleaned.replace(/^##\s*Included Rules[\s\S]*?<\/user-rule>\s*/i, '').trim();
      cleaned = cleaned.replace(/\s*<EnvironmentContext>[\s\S]*?<\/EnvironmentContext>\s*$/i, '').trim();
      cleaned = cleaned.replace(/\s*<OPEN-EDITOR-FILES>[\s\S]*?<\/OPEN-EDITOR-FILES>\s*/gi, '').trim();
      cleaned = cleaned.replace(/\s*<ACTIVE-EDITOR-FILE>[\s\S]*?<\/ACTIVE-EDITOR-FILE>\s*/gi, '').trim();
    }

    return cleaned;
  }

  private isLegacyAssistantAck(text: string): boolean {
    const normalized = text.trim();
    return (
      normalized === 'I will follow these instructions.' ||
      normalized === 'Understood.' ||
      normalized === 'On it.'
    );
  }

  private parseLegacyKiroChat(raw: string): ChatMessage[] {
    const messages: ChatMessage[] = [];
    try {
      const obj = JSON.parse(raw) as KiroChatFile;
      const chatArr = obj.chat || [];
      if (!Array.isArray(chatArr)) return [];

      for (const msg of chatArr) {
        if (!msg.content || !msg.role) continue;
        const text = this.sanitizeLegacyKiroMessage(msg.role, msg.content);
        if (!text) continue;

        // Skip tool results — workspace file trees, command outputs, not conversation content
        if (msg.role === 'tool') continue;

        // Skip bot acknowledgement-only responses
        if ((msg.role === 'bot' || msg.role === 'assistant') && this.isLegacyAssistantAck(text)) continue;

        let role: ChatMessage['role'] = 'assistant';
        if (msg.role === 'human' || msg.role === 'user') role = 'user';
        else if (msg.role === 'bot' || msg.role === 'assistant') role = 'assistant';

        messages.push({ role, content: text });
      }
    } catch { /* ignore parse error */ }

    return messages;
  }
}
