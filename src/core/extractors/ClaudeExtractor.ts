import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as readline from 'readline';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { CapturedSession, ChatMessage, IChatExtractor } from './types';

type ClaudeContentItem = {
  type?: string;
  text?: string;
  thinking?: string;
  // tool_result items (skip these)
  tool_use_id?: string;
  content?: string;
};

type ClaudeJsonlRecord = {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  uuid?: string;
  message?: {
    role?: string;
    content?: Array<ClaudeContentItem>;
  };
};

export class ClaudeExtractor implements IChatExtractor {
  readonly ideId = 'claude' as const;

  private getScanPaths(): string[] {
    const defaultPath = path.join(os.homedir(), '.claude', 'projects');
    const paths = [defaultPath];

    try {
      const customConfig = vscode.workspace.getConfiguration('edoTensei').get<Record<string, string[]>>('customScanPaths') || {};
      const custom = customConfig[this.ideId];
      if (Array.isArray(custom)) {
        paths.push(...custom);
      }
    } catch (e) {
      // Configuration might not be available during testing
    }

    return paths;
  }

  private isLazyEnabled(): boolean {
    try {
      return vscode.workspace.getConfiguration('edoTensei').get<boolean>('lazyLoadMessages', true);
    } catch {
      return true;
    }
  }

  async extract(workspacePath?: string): Promise<CapturedSession> {
    const sessions = await this.extractAll(workspacePath);
    return sessions.length > 0
      ? sessions[0]
      : {
          sourceIde: this.ideId,
          capturedAt: new Date().toISOString(),
          messages: [],
          rawPath: this.getScanPaths()[0],
          readStatus: 'empty',
        };
  }

  async extractAll(workspacePath?: string): Promise<CapturedSession[]> {
    const lazy = this.isLazyEnabled();
    const scanPaths = this.getScanPaths();
    const results: CapturedSession[] = [];

    for (const projectsDir of scanPaths) {
      try {
        await fs.access(projectsDir);
      } catch {
        continue;
      }

      const projectDirs = await this.safeReadDir(projectsDir);
      for (const projectSlug of projectDirs) {
        const projectPath = path.join(projectsDir, projectSlug);
        const st = await this.safeStat(projectPath);
        if (!st?.isDirectory()) continue;

        if (workspacePath && !this.isSlugMatchWorkspace(projectSlug, workspacePath)) {
          continue;
        }

        const entries = await this.safeReadDir(projectPath);
        for (const entry of entries) {
          if (!entry.endsWith('.jsonl')) continue;

          const filePath = path.join(projectPath, entry);
          const fileStat = await this.safeStat(filePath);
          if (!fileStat) continue;
          if (fileStat.size < 200) continue;

          if (lazy) {
            const { message: firstMsg, cwd } = await this.prescanFirstUserMessage(filePath);
            // If no user message found in first 16KB, still include session as Untitled
            const messages: ChatMessage[] = firstMsg ? [firstMsg] : [];
            results.push({
              sourceIde: this.ideId,
              capturedAt: new Date(fileStat.mtimeMs).toISOString(),
              sessionId: path.basename(entry, '.jsonl'),
              workspacePath: cwd || this.slugToWorkspacePath(projectSlug),
              messages,
              messagesLoaded: false,
              rawPath: filePath,
              readStatus: 'success',
            });
          } else {
            const raw = await this.safeReadFile(filePath);
            if (!raw) continue;
            const { messages, cwd } = this.parseClaudeJsonlWithMeta(raw);
            if (messages.length === 0) continue;
            results.push({
              sourceIde: this.ideId,
              capturedAt: new Date(fileStat.mtimeMs).toISOString(),
              sessionId: path.basename(entry, '.jsonl'),
              workspacePath: cwd || this.slugToWorkspacePath(projectSlug),
              messages,
              messagesLoaded: true,
              rawPath: filePath,
              readStatus: 'success',
            });
          }
        }
      }
    }

    return results.sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
  }

  /**
   * Reads the first 16KB of a .jsonl file, captures the cwd and the first valid user message.
   * Used during lazy extractAll() for title extraction and reliable workspace path resolution.
   * Note: slugToWorkspacePath() is ambiguous for hyphenated folder names, so cwd is preferred.
   */
  private async prescanFirstUserMessage(filePath: string): Promise<{ message: ChatMessage | undefined; cwd: string | undefined }> {
    let fd: fs.FileHandle | undefined;
    let cwd: string | undefined;
    let firstMsg: ChatMessage | undefined;
    try {
      fd = await fs.open(filePath, 'r');
      const buffer = Buffer.alloc(16384);
      const { bytesRead } = await fd.read(buffer, 0, 16384, 0);
      const chunk = buffer.toString('utf8', 0, bytesRead);

      for (const line of chunk.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let obj: ClaudeJsonlRecord;
        try { obj = JSON.parse(trimmed) as ClaudeJsonlRecord; } catch { continue; }

        if (!cwd && obj.cwd) {
          cwd = obj.cwd;
        }

        if (!firstMsg && (obj.type || '').toLowerCase() === 'user') {
          const msg = this.extractMessageFromRecord(obj);
          if (msg) firstMsg = msg;
        }

        if (cwd && firstMsg) break;
      }
    } catch {
      // ignore read errors
    } finally {
      await fd?.close();
    }
    return { message: firstMsg, cwd };
  }

  /**
   * Fully loads all messages for a session. Size-tiered to prevent OOM.
   * Called lazily by SessionHandoffService.ensureSessionMessagesLoaded().
   */
  async loadFullMessages(session: CapturedSession): Promise<void> {
    const fileStat = await this.safeStat(session.rawPath);
    if (!fileStat) return;

    const sizeMB = fileStat.size / (1024 * 1024);

    if (sizeMB < 1) {
      // Small file: safe to read entirely
      const raw = await this.safeReadFile(session.rawPath);
      if (!raw) return;
      session.messages = this.parseClaudeJsonl(raw);
    } else {
      // Medium/large: readline streaming to cap memory usage
      const truncateLines = sizeMB > 10;
      session.messages = await this.parseClaudeJsonlStreaming(session.rawPath, truncateLines);
    }
  }

  /**
   * Streaming line-by-line parser. For files > 10MB, enforces a 50KB per-content-item cap.
   */
  private async parseClaudeJsonlStreaming(filePath: string, truncateLines: boolean): Promise<ChatMessage[]> {
    const MAX_ITEM_CHARS = 50_000;
    const messages: ChatMessage[] = [];

    const stream = fsSync.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj: ClaudeJsonlRecord;
      try { obj = JSON.parse(trimmed) as ClaudeJsonlRecord; } catch { continue; }

      const msg = this.extractMessageFromRecord(obj, truncateLines ? MAX_ITEM_CHARS : undefined);
      if (msg) messages.push(msg);
    }

    return messages;
  }

  /**
   * Shared extraction logic: converts a ClaudeJsonlRecord into a ChatMessage.
   * @param maxItemChars - if set, truncates each content item to this length
   */
  private extractMessageFromRecord(obj: ClaudeJsonlRecord, maxItemChars?: number): ChatMessage | undefined {
    const type = (obj.type || '').toLowerCase();
    if (type !== 'user' && type !== 'assistant') return undefined;

    const role: ChatMessage['role'] = type === 'user' ? 'user' : 'assistant';
    const contentArr = obj.message?.content ?? [];
    const textParts: string[] = [];

    for (const c of contentArr) {
      if (!c) continue;
      if (c.type === 'tool_result') continue;
      if (c.type === 'text' || typeof c.text === 'string') {
        let stripped = (c.text || '')
          .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '')
          .replace(/<[^>]+>/g, '')
          .trim();
        if (maxItemChars && stripped.length > maxItemChars) {
          stripped = stripped.slice(0, maxItemChars) + `\n...[truncated ${stripped.length - maxItemChars} chars]`;
        }
        if (stripped.length > 0) textParts.push(stripped);
      } else if (c.type === 'thinking' && typeof c.thinking === 'string') {
        textParts.push(c.thinking.trim());
      }
    }

    const text = textParts.join('\n').trim();
    if (!text) return undefined;

    return { role, content: text, timestamp: obj.timestamp };
  }

  private parseClaudeJsonl(raw: string): ChatMessage[] {
    return this.parseClaudeJsonlWithMeta(raw).messages;
  }

  private parseClaudeJsonlWithMeta(raw: string): { messages: ChatMessage[]; cwd: string | undefined } {
    const messages: ChatMessage[] = [];
    let cwd: string | undefined;
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj: ClaudeJsonlRecord | undefined;
      try { obj = JSON.parse(trimmed) as ClaudeJsonlRecord; } catch { continue; }
      if (!cwd && obj.cwd) cwd = obj.cwd;
      const msg = this.extractMessageFromRecord(obj);
      if (msg) messages.push(msg);
    }
    return { messages, cwd };
  }

  private isSlugMatchWorkspace(slug: string, workspacePath: string): boolean {
    const normalizedSlug = slug.toLowerCase();
    const normalizedWs = workspacePath
      .replace(/\\/g, '-')
      .replace(/\//g, '-')
      .replace(/:/g, '-')
      .toLowerCase();
    return normalizedSlug.includes(normalizedWs) || normalizedWs.includes(normalizedSlug);
  }

  private slugToWorkspacePath(slug: string): string | undefined {
    const winMatch = slug.match(/^([a-z])--(.+)$/i);
    if (winMatch) {
      const drive = winMatch[1].toUpperCase();
      const rest = winMatch[2].replace(/-/g, path.sep);
      return `${drive}:${path.sep}${rest}`;
    }
    if (slug.startsWith('-')) {
      return '/' + slug.slice(1).replace(/-/g, '/');
    }
    return undefined;
  }

  private async safeReadDir(dir: string): Promise<string[]> {
    try { return await fs.readdir(dir); } catch { return []; }
  }

  private async safeStat(p: string): Promise<import('fs').Stats | undefined> {
    try { return await fs.stat(p); } catch { return undefined; }
  }

  private async safeReadFile(p: string): Promise<string | undefined> {
    try { return await fs.readFile(p, 'utf8'); } catch { return undefined; }
  }
}
