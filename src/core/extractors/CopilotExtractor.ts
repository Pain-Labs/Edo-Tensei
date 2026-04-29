/**
 * CopilotExtractor.ts
 * 
 * 讀取 VS Code GitHub Copilot Chat 的歷史記錄。
 * 
 * 儲存路徑：%APPDATA%/Code/User/globalStorage/emptyWindowChatSessions/
 * 格式：每個 session 一個 .json 或 .jsonl 檔案
 *   - .json：舊版格式，根層級有 `requests[]`，每個 request 有 message (user) + response[] (assistant)
 *   - .jsonl：新版格式，每行一個 JSON 物件
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { CapturedSession, ChatMessage, IChatExtractor } from './types';

// ─── Copilot JSON Schema Types ─────────────────────────────────────────────────

interface CopilotMessagePart {
  kind?: string;
  value?: string;
  supportThemeIcons?: boolean;
  supportHtml?: boolean;
}

interface CopilotRequest {
  message?: {
    text?: string;
    parts?: CopilotMessagePart[];
  };
  response?: CopilotMessagePart[];
  timestamp?: number;
  modelId?: string;
}

interface CopilotSession {
  version?: number;
  sessionId?: string;
  creationDate?: number;
  lastMessageDate?: number;
  customTitle?: string;
  requests?: CopilotRequest[];
}

// ─── JSONL types ───────────────────────────────────────────────────────────────

interface CopilotJsonlLine {
  kind?: number;
  v?: CopilotSession;
}

export class CopilotExtractor implements IChatExtractor {
  readonly ideId = 'copilot' as const;

  private getBaseDir(): string {
    const appData = process.env.APPDATA || '';
    return path.join(appData, 'Code', 'User', 'globalStorage', 'emptyWindowChatSessions');
  }

  private getWorkspaceStorageDir(): string {
    const appData = process.env.APPDATA || '';
    return path.join(appData, 'Code', 'User', 'workspaceStorage');
  }

  async extract(workspacePath?: string, customScanPaths: string[] = []): Promise<CapturedSession> {
    const emptyWindowDir = this.getBaseDir();
    const workspaceStorageDir = this.getWorkspaceStorageDir();

    let targetDirs: string[] = [...customScanPaths, emptyWindowDir];

    if (workspacePath) {
      try {
        const entries = await fs.readdir(workspaceStorageDir);
        const stats = await this.listDirsByMtime(workspaceStorageDir, entries);

        for (const { name } of stats.slice(0, 30)) {
          const wsJsonPath = path.join(workspaceStorageDir, name, 'workspace.json');
          try {
            const content = await fs.readFile(wsJsonPath, 'utf8');
            const wsJson = JSON.parse(content);
            const folderUri = wsJson.folder || wsJson.workspace;
            if (folderUri && typeof folderUri === 'string') {
              const decodedUri = decodeURIComponent(folderUri);
              const normalizedWsPath = workspacePath.replace(/\\/g, '/').toLowerCase();
              if (decodedUri.toLowerCase().includes(normalizedWsPath)) {
                const chatSessionsDir = path.join(workspaceStorageDir, name, 'chatSessions');
                targetDirs.unshift(chatSessionsDir);
                break;
              }
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }

    for (const dir of targetDirs) {
      const sessions = await this.extractFromDir(dir);
      if (sessions.length > 0) return sessions[0];
    }

    return { sourceIde: this.ideId, capturedAt: new Date().toISOString(), messages: [], rawPath: emptyWindowDir, readStatus: 'empty' };
  }

  async extractAll(_workspacePath?: string, customScanPaths: string[] = []): Promise<CapturedSession[]> {
    const emptyWindowDir = this.getBaseDir();
    const workspaceStorageDir = this.getWorkspaceStorageDir();
    const allSessions: CapturedSession[] = [];

    // 1. Scan empty window sessions and custom paths
    const scanDirs = [...customScanPaths, emptyWindowDir];
    for (const dir of scanDirs) {
        const sessions = await this.extractFromDir(dir);
        allSessions.push(...sessions);
    }

    // 2. Scan all workspace storage folders
    try {
      const entries = await fs.readdir(workspaceStorageDir);
      for (const entry of entries) {
        const entryDir = path.join(workspaceStorageDir, entry);
        let resolvedWsPath: string | undefined;

        // Try to get actual workspace path from workspace.json
        try {
          const wsJsonPath = path.join(entryDir, 'workspace.json');
          const content = await fs.readFile(wsJsonPath, 'utf8');
          const wsJson = JSON.parse(content);
          const folderUri = wsJson.folder || wsJson.workspace;
          if (folderUri && typeof folderUri === 'string') {
            resolvedWsPath = decodeURIComponent(folderUri).replace(/^file:\/\/\//, '').replace(/\//g, path.sep);
          }
        } catch { /* skip */ }

        const chatSessionsDir = path.join(entryDir, 'chatSessions');
        const sessions = await this.extractFromDir(chatSessionsDir, resolvedWsPath);
        allSessions.push(...sessions);
      }
    } catch { /* skip */ }

    return allSessions.sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
  }

  private async listDirsByMtime(baseDir: string, entries: string[]): Promise<Array<{ name: string; mtime: number }>> {
    const stats = await Promise.all(
      entries.map(async e => {
        try {
          const s = await fs.stat(path.join(baseDir, e));
          return { name: e, mtime: s.mtimeMs };
        } catch { return { name: e, mtime: 0 }; }
      })
    );
    return stats.sort((a, b) => b.mtime - a.mtime);
  }

  private async extractFromDir(dir: string, wsPath?: string): Promise<CapturedSession[]> {
    try {
      await fs.access(dir);
      const entries = await fs.readdir(dir);
      const files = entries.filter(e => e.endsWith('.json') || e.endsWith('.jsonl'));
      const results: CapturedSession[] = [];

      // A & B: 檔案大小過濾與並行處理
      const CHUNK_SIZE = 20; // 同時處理 20 個檔案
      for (let i = 0; i < files.length; i += CHUNK_SIZE) {
        const chunk = files.slice(i, i + CHUNK_SIZE);
        await Promise.all(chunk.map(async (f) => {
          const filePath = path.join(dir, f);
          try {
            const s = await fs.stat(filePath);
            
            // 優化 A: 如果檔案小於 500 bytes，通常是沒有對話的空紀錄，直接跳過不讀取
            if (s.size < 500) {
              return;
            }

            const raw = await fs.readFile(filePath, 'utf8');
            const sessions: CopilotSession[] = [];

            if (filePath.endsWith('.jsonl')) {
              for (const line of raw.split('\n')) {
                const trimmed = line.trim();
                if (trimmed) {
                  try {
                    const parsed = JSON.parse(trimmed) as CopilotJsonlLine;
                    if (parsed.v) sessions.push(parsed.v);
                  } catch { /* skip */ }
                }
              }
            } else {
              try {
                sessions.push(JSON.parse(raw) as CopilotSession);
              } catch { /* skip */ }
            }

            for (const session of sessions) {
              if (session && session.requests && session.requests.length > 0) {
                const messages = this.parseMessages(session.requests);
                if (messages.length > 0) {
                  results.push({
                    sourceIde: this.ideId,
                    capturedAt: new Date(s.mtimeMs).toISOString(),
                    sessionId: session.sessionId || path.basename(f, path.extname(f)),
                    title: session.customTitle,
                    workspacePath: wsPath,
                    messages,
                    rawPath: filePath,
                    readStatus: 'success',
                  });
                }
              }
            }
          } catch { /* skip */ }
        }));
      }
      return results;
    } catch {
      return [];
    }
  }

  private parseMessages(requests: CopilotRequest[]): ChatMessage[] {
    const messages: ChatMessage[] = [];

    for (const req of requests) {
      const userText = req.message?.text?.trim() ?? '';
      if (userText) {
        messages.push({
          role: 'user',
          content: userText,
          timestamp: req.timestamp ? new Date(req.timestamp).toISOString() : undefined,
        });
      }

      if (req.response) {
        const assistantParts = req.response
          .filter(p => p.value && !p.kind)
          .map(p => p.value ?? '')
          .join('');
        if (assistantParts.trim()) {
          messages.push({
            role: 'assistant',
            content: assistantParts.trim(),
            timestamp: req.timestamp ? new Date(req.timestamp).toISOString() : undefined,
          });
        }
      }
    }

    return messages;
  }
}
