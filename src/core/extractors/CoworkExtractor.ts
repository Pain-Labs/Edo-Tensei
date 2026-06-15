import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as readline from 'readline';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { CapturedSession, ChatMessage, IChatExtractor } from './types';

/**
 * Cowork's dispatch-parent audit.jsonl echoes every user message twice:
 * once when received, once when re-injected into the orchestrator context.
 * This deduplicator drops the second occurrence if content is identical
 * and the timestamp is within 60 seconds of the first.
 */
class CoworkDeduplicator {
  private seen = new Map<string, number>(); // contentHash -> epoch ms

  accept(msg: ChatMessage): boolean {
    const key = `${msg.role}:${msg.content}`;
    const ts = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;
    const prev = this.seen.get(key);
    if (prev !== undefined && ts - prev < 60_000) return false;
    this.seen.set(key, ts || Date.now());
    return true;
  }
}

/**
 * Patterns for user-role records that are actually Cowork system injections,
 * not real human messages: tool completion callbacks, orchestrator reminders, etc.
 */
const SYSTEM_INJECTION_RE = /^(Task ".+?" completed\.|You ended the turn without calling|You've hit your session limit|You have \d+ task|SendUserMessage)/;

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

          // Each local_{uuid}/ directory is one focused child session (single topic).
          // The dispatch parent (agent/local_ditto_*/audit.jsonl) spans ALL child sessions
          // and is intentionally skipped — it mixes every topic into one long transcript.
          const entries = await this.safeReadDir(convPath);
          for (const entry of entries) {
            if (!entry.startsWith('local_') || entry.startsWith('local_ditto_')) continue;
            const childDir = path.join(convPath, entry);
            const childSt = await this.safeStat(childDir);
            if (!childSt?.isDirectory()) continue;

            const auditPath = path.join(childDir, 'audit.jsonl');
            const auditSt = await this.safeStat(auditPath);
            if (!auditSt || auditSt.size < 100) continue;

            const metaPath = path.join(convPath, `${entry}.json`);
            const meta = await this.readChildMeta(metaPath);

            candidates.push({
              auditPath,
              lastActivityAt: meta.lastActivityAt ?? auditSt.mtimeMs,
              title: meta.title || 'Cowork session',
              sessionId: entry.replace(/^local_/, ''),
            });
          }
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

  private async readChildMeta(metaPath: string): Promise<CoworkMetadata> {
    try {
      const raw = await fs.readFile(metaPath, 'utf8');
      return JSON.parse(raw) as CoworkMetadata;
    } catch {
      return {};
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
        if (msg?.role === 'user' && !SYSTEM_INJECTION_RE.test(msg.content)) return msg;
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
      const dedup = new CoworkDeduplicator();
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let obj: CoworkRecord;
        try { obj = JSON.parse(trimmed) as CoworkRecord; } catch { continue; }
        const msg = this.recordToMessage(obj);
        if (msg && dedup.accept(msg)) messages.push(msg);
      }
      return messages;
    } catch {
      return [];
    }
  }

  private async parseAuditJsonlStreaming(auditPath: string, truncate: boolean): Promise<ChatMessage[]> {
    const MAX_CHARS = 50_000;
    const messages: ChatMessage[] = [];
    const dedup = new CoworkDeduplicator();
    const stream = fsSync.createReadStream(auditPath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj: CoworkRecord;
      try { obj = JSON.parse(trimmed) as CoworkRecord; } catch { continue; }
      const msg = this.recordToMessage(obj, truncate ? MAX_CHARS : undefined);
      if (msg && dedup.accept(msg)) messages.push(msg);
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
        // Include only visible text blocks — skip thinking (internal reasoning)
        if (block.type === 'text' && typeof (block as { text?: string }).text === 'string') {
          parts.push(((block as { text: string }).text).trim());
        }
      }
      text = parts.join('\n').trim();
    }

    if (!text) return undefined;

    // Filter out Cowork system-injected user messages (tool result re-injections)
    if (role === 'user' && SYSTEM_INJECTION_RE.test(text)) return undefined;

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
