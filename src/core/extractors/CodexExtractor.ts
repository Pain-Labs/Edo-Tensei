import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { CapturedSession, ChatMessage, IChatExtractor } from './types';

type CodexJsonlRecord = {
  timestamp?: string;
  type?: string;
  payload?: any;
};

export class CodexExtractor implements IChatExtractor {
  readonly ideId = 'codex' as const;

  private getBaseDir(): string {
    return path.join(os.homedir(), '.codex');
  }

  private getSessionsDir(): string {
    return path.join(this.getBaseDir(), 'sessions');
  }

  async extract(workspacePath?: string, customScanPaths: string[] = []): Promise<CapturedSession> {
    const sessions = await this.extractAll(workspacePath, customScanPaths);
    return sessions.length > 0
      ? sessions[0]
      : {
          sourceIde: this.ideId,
          capturedAt: new Date().toISOString(),
          messages: [],
          rawPath: this.getSessionsDir(),
          readStatus: 'empty',
        };
  }

  async extractAll(workspacePath?: string, customScanPaths: string[] = []): Promise<CapturedSession[]> {
    const sessionsDir = this.getSessionsDir();
    const dirsToScan = [...customScanPaths, sessionsDir];
    const rolloutFiles: string[] = [];

    for (const scanDir of dirsToScan) {
      try {
        await fs.access(scanDir);
        const files = await this.findRolloutFiles(scanDir);
        rolloutFiles.push(...files);
      } catch {
        continue;
      }
    }

    const results: CapturedSession[] = [];

    // Chunked concurrency for performance
    const CHUNK_SIZE = 10;
    for (let i = 0; i < rolloutFiles.length; i += CHUNK_SIZE) {
      const chunk = rolloutFiles.slice(i, i + CHUNK_SIZE);
      const chunkResults = await Promise.all(
        chunk.map(async (filePath) => {
          const st = await this.safeStat(filePath);
          if (!st) return null;
          if (st.size < 200) return null;

          const raw = await this.safeReadFile(filePath);
          if (!raw) return null;

          const parsed = this.parseCodexRollout(raw);
          if (parsed.messages.length === 0) return null;

          // workspace filtering: compare against parsed cwd (best-effort)
          if (workspacePath && parsed.cwd) {
            const ws = this.normalizePath(workspacePath);
            const cwd = this.normalizePath(parsed.cwd);
            if (!cwd.includes(ws)) {
              return null;
            }
          } else if (workspacePath && !parsed.cwd) {
            // No cwd info -> fall back to file path substring check
            const ws = this.normalizePath(workspacePath);
            const fp = this.normalizePath(filePath);
            if (!fp.includes(ws)) {
              return null;
            }
          }

          return {
            sourceIde: this.ideId,
            capturedAt: new Date(st.mtimeMs).toISOString(),
            sessionId: parsed.sessionId,
            title: parsed.title,
            workspacePath: parsed.cwd,
            messages: parsed.messages,
            rawPath: filePath,
            readStatus: 'success',
          } satisfies CapturedSession;
        })
      );

      for (const r of chunkResults) {
        if (r) results.push(r);
      }
    }

    return results.sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
  }

  private parseCodexRollout(raw: string): { messages: ChatMessage[]; cwd?: string; sessionId?: string; title?: string } {
    const messages: ChatMessage[] = [];
    let cwd: string | undefined;
    let sessionId: string | undefined;

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let obj: CodexJsonlRecord | undefined;
      try {
        obj = JSON.parse(trimmed) as CodexJsonlRecord;
      } catch {
        continue;
      }

      if (!obj?.type) continue;

      if (obj.type === 'session_meta') {
        const payload = obj.payload || {};
        if (typeof payload.cwd === 'string') cwd = payload.cwd;
        if (typeof payload.id === 'string') sessionId = payload.id;
        continue;
      }

      // Most useful user/assistant contents are in response_item
      if (obj.type === 'response_item') {
        const payload = obj.payload || {};
        if (payload.type !== 'message') continue;

        const role = payload.role as string | undefined;
        if (role !== 'user' && role !== 'assistant' && role !== 'developer' && role !== 'system') continue;

        const contentArr = payload.content as Array<{ type?: string; text?: string; input_text?: string }> | undefined;
        if (!Array.isArray(contentArr)) continue;

        const text = contentArr
          .map((c) => {
            if (!c) return '';
            if (typeof c.text === 'string') return c.text;
            if (typeof c.input_text === 'string') return c.input_text;
            return '';
          })
          .join('')
          .trim();

        if (!text) continue;

        // Map developer/system to system to reduce noise in the tree view (still kept in transcript).
        const mappedRole: ChatMessage['role'] = role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'system';
        messages.push({ role: mappedRole, content: text, timestamp: obj.timestamp });
      }
    }

    return { messages, cwd, sessionId };
  }

  private async findRolloutFiles(root: string): Promise<string[]> {
    const results: string[] = [];

    const walk = async (dir: string, depth: number) => {
      if (depth > 5) return;
      let entries: import('fs').Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          await walk(full, depth + 1);
        } else if (e.isFile()) {
          if (e.name.toLowerCase().startsWith('rollout-') && e.name.toLowerCase().endsWith('.jsonl')) {
            results.push(full);
          }
        }
      }
    };

    await walk(root, 0);
    return results;
  }

  private normalizePath(p: string): string {
    return path.resolve(p).replace(/\\/g, '/').toLowerCase();
  }

  private async safeStat(p: string): Promise<import('fs').Stats | undefined> {
    try {
      return await fs.stat(p);
    } catch {
      return undefined;
    }
  }

  private async safeReadFile(p: string): Promise<string | undefined> {
    try {
      return await fs.readFile(p, 'utf8');
    } catch {
      return undefined;
    }
  }
}
