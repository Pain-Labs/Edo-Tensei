import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as readline from 'readline';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { CapturedSession, ChatMessage, IChatExtractor } from './types';

type CoworkContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: string; [key: string]: unknown };

type CoworkRecord = {
  type?: string;
  subtype?: string;
  _audit_timestamp?: string;
  message?: {
    role?: string;
    content?: string | CoworkContentBlock[];
  };
};

type CoworkMetadata = {
  title?: string;
  lastActivityAt?: number;
  createdAt?: number;
  initialMessage?: string;
  sessionType?: string;
};

export class CoworkExtractor implements IChatExtractor {
  readonly ideId = 'cowork' as const;
  readonly supportsPagedExtraction = true;

  private getScanPaths(): string[] {
    const home = os.homedir();
    const platform = process.platform;

    let defaults: string[];
    if (platform === 'win32') {
      const appData = process.env.APPDATA ?? '';
      defaults = [path.join(appData, 'Claude', 'local-agent-mode-sessions')];
    } else if (platform === 'darwin') {
      defaults = [path.join(home, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions')];
    } else {
      defaults = [path.join(home, '.config', 'Claude', 'local-agent-mode-sessions')];
    }

    try {
      const customConfig = vscode.workspace.getConfiguration('edoTensei').get<Record<string, string[]>>('customScanPaths') || {};
      const custom = customConfig[this.ideId];
      if (Array.isArray(custom)) {
        return [...new Set([...defaults, ...custom])];
      }
    } catch {
      // Configuration might not be available during testing
    }

    return defaults;
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
          rawPath: this.getScanPaths()[0] ?? '',
          readStatus: 'empty',
        };
  }

  async extractAll(
    _workspacePath?: string,
    customScanPaths: string[] = [],
    options?: { limit?: number; offset?: number }
  ): Promise<CapturedSession[]> {
    const offset = Math.max(0, options?.offset ?? 0);
    const limit = options?.limit;
    const lazy = this.isLazyEnabled();

    const scanPaths = [...new Set([...this.getScanPaths(), ...customScanPaths])];

    type Candidate = {
      auditPath: string;
      lastActivityAt: number;
      title: string;
      sessionId: string;
    };
    const candidates: Candidate[] = [];

    for (const basePath of scanPaths) {
      try { await fs.access(basePath); } catch { continue; }

      // base/{session-uuid}/
      const sessionDirs = await this.safeReadDir(basePath);
      for (const sessionUuid of sessionDirs) {
        const sessionPath = path.join(basePath, sessionUuid);
        const st = await this.safeStat(sessionPath);
        if (!st?.isDirectory()) continue;

        // base/{session-uuid}/{conversation-uuid}/
        const convDirs = await this.safeReadDir(sessionPath);
        for (const convUuid of convDirs) {
          const convPath = path.join(sessionPath, convUuid);
          const convSt = await this.safeStat(convPath);
          if (!convSt?.isDirectory()) continue;

          // Main transcript: agent/local_ditto_{conv-uuid}/audit.jsonl
          const auditPath = path.join(convPath, 'agent', `local_ditto_${convUuid}`, 'audit.jsonl');
          const auditSt = await this.safeStat(auditPath);
          if (!auditSt || auditSt.size < 100) continue;

          const { title, lastActivityAt } = await this.readConvMetadata(convPath, convUuid);

          candidates.push({
            auditPath,
            lastActivityAt,
            title,
            sessionId: convUuid,
          });
        }
      }
    }

    candidates.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    const selected = limit !== undefined
      ? candidates.slice(offset, offset + limit)
      : candidates.slice(offset);

    const results = await Promise.all(
      selected.map(async ({ auditPath, lastActivityAt, title, sessionId }) => {
        if (lazy) {
          const firstMsg = await this.prescanFirstUserMessage(auditPath);
          return {
            sourceIde: this.ideId,
            capturedAt: new Date(lastActivityAt).toISOString(),
            sessionId,
            title,
            messages: firstMsg ? [firstMsg] : [],
            messagesLoaded: false,
            rawPath: auditPath,
            readStatus: 'success' as const,
          };
        } else {
          const messages = await this.parseAuditJsonl(auditPath);
          if (messages.length === 0) return null;
          return {
            sourceIde: this.ideId,
            capturedAt: new Date(lastActivityAt).toISOString(),
            sessionId,
            title,
            messages,
            messagesLoaded: true,
            rawPath: auditPath,
            readStatus: 'success' as const,
          };
        }
      })
    );

    return results.filter(Boolean) as CapturedSession[];
  }

  /**
   * Reads the most recent child session metadata to get title and lastActivityAt.
   * Falls back to the dispatch-parent metadata if no child sessions found.
   */
  private async readConvMetadata(
    convPath: string,
    convUuid: string
  ): Promise<{ title: string; lastActivityAt: number }> {
    // Child metadata: local_{uuid}.json files (sessionType: 'dispatch_child')
    const entries = await this.safeReadDir(convPath);
    let bestChild: CoworkMetadata | null = null;
    let bestTs = 0;

    for (const entry of entries) {
      if (!entry.startsWith('local_') || !entry.endsWith('.json')) continue;
      if (entry.startsWith(`local_ditto_`)) continue;
      try {
        const raw = await fs.readFile(path.join(convPath, entry), 'utf8');
        const meta = JSON.parse(raw) as CoworkMetadata;
        const ts = meta.lastActivityAt ?? 0;
        if (ts > bestTs) {
          bestTs = ts;
          bestChild = meta;
        }
      } catch {
        // ignore
      }
    }

    if (bestChild?.title && bestChild.title !== 'New chat' && bestChild.lastActivityAt) {
      return { title: bestChild.title, lastActivityAt: bestChild.lastActivityAt };
    }

    // Fallback: dispatch-parent metadata
    try {
      const parentMetaPath = path.join(convPath, 'agent', `local_ditto_${convUuid}.json`);
      const raw = await fs.readFile(parentMetaPath, 'utf8');
      const meta = JSON.parse(raw) as CoworkMetadata;
      const title = (meta.title && meta.title !== 'New chat')
        ? meta.title
        : (meta.initialMessage ?? '').slice(0, 60) || 'Cowork session';
      return { title, lastActivityAt: meta.lastActivityAt ?? Date.now() };
    } catch {
      return { title: 'Cowork session', lastActivityAt: bestTs || Date.now() };
    }
  }

  async loadFullMessages(session: CapturedSession): Promise<void> {
    const fileStat = await this.safeStat(session.rawPath);
    if (!fileStat) return;

    const sizeMB = fileStat.size / (1024 * 1024);
    session.messages = sizeMB > 10
      ? await this.parseAuditJsonlStreaming(session.rawPath, true)
      : await this.parseAuditJsonl(session.rawPath);
    session.messagesLoaded = true;
  }

  private async prescanFirstUserMessage(auditPath: string): Promise<ChatMessage | undefined> {
    let fd: fs.FileHandle | undefined;
    try {
      fd = await fs.open(auditPath, 'r');
      const buffer = Buffer.alloc(16384);
      const { bytesRead } = await fd.read(buffer, 0, 16384, 0);
      const chunk = buffer.toString('utf8', 0, bytesRead);
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let obj: CoworkRecord;
        try { obj = JSON.parse(trimmed) as CoworkRecord; } catch { continue; }
        const msg = this.recordToMessage(obj);
        if (msg?.role === 'user') return msg;
      }
    } catch {
      // ignore
    } finally {
      await fd?.close();
    }
    return undefined;
  }

  private async parseAuditJsonl(auditPath: string): Promise<ChatMessage[]> {
    try {
      const raw = await fs.readFile(auditPath, 'utf8');
      const messages: ChatMessage[] = [];
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let obj: CoworkRecord;
        try { obj = JSON.parse(trimmed) as CoworkRecord; } catch { continue; }
        const msg = this.recordToMessage(obj);
        if (msg) messages.push(msg);
      }
      return messages;
    } catch {
      return [];
    }
  }

  private async parseAuditJsonlStreaming(auditPath: string, truncate: boolean): Promise<ChatMessage[]> {
    const MAX_CHARS = 50_000;
    const messages: ChatMessage[] = [];
    const stream = fsSync.createReadStream(auditPath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj: CoworkRecord;
      try { obj = JSON.parse(trimmed) as CoworkRecord; } catch { continue; }
      const msg = this.recordToMessage(obj, truncate ? MAX_CHARS : undefined);
      if (msg) messages.push(msg);
    }
    return messages;
  }

  private recordToMessage(obj: CoworkRecord, maxChars?: number): ChatMessage | undefined {
    const type = obj.type;
    if (type !== 'user' && type !== 'assistant') return undefined;

    const role: ChatMessage['role'] = type === 'user' ? 'user' : 'assistant';
    const content = obj.message?.content;
    let text = '';

    if (typeof content === 'string') {
      text = content.trim();
    } else if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const block of content) {
        if (block.type === 'text' && typeof (block as { text?: string }).text === 'string') {
          parts.push(((block as { text: string }).text).trim());
        } else if (block.type === 'thinking' && typeof (block as { thinking?: string }).thinking === 'string') {
          parts.push(((block as { thinking: string }).thinking).trim());
        }
      }
      text = parts.join('\n').trim();
    }

    if (!text) return undefined;
    if (maxChars && text.length > maxChars) {
      text = text.slice(0, maxChars) + `\n...[truncated ${text.length - maxChars} chars]`;
    }

    return { role, content: text, timestamp: obj._audit_timestamp };
  }

  private async safeReadDir(dir: string): Promise<string[]> {
    try { return await fs.readdir(dir); } catch { return []; }
  }

  private async safeStat(p: string): Promise<import('fs').Stats | undefined> {
    try { return await fs.stat(p); } catch { return undefined; }
  }
}
