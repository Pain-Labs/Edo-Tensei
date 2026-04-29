/**
 * KiroExtractor.ts
 *
 * 讀取 Kiro 的對話記錄。
 *
 * 儲存路徑：%APPDATA%\Kiro\User\globalStorage\kiro.kiroagent\
 * 在此目錄下的各專案 hash 資料夾中，會有很多 `.chat` 檔案，內容為 JSON。
 *
 * JSON 結構大致為：
 * {
 *   "context": [
 *     { "role": "user", "content": "..." },
 *     { "role": "bot", "content": "..." },
 *     { "role": "tool", "content": "..." }
 *   ]
 * }
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { CapturedSession, ChatMessage, IChatExtractor } from './types';

interface KiroChatFile {
  chat?: Array<{
    role?: string;
    content?: string;
  }>;
}

export class KiroExtractor implements IChatExtractor {
  readonly ideId = 'kiro' as const;

  private getProjectsDir(): string {
    const appData = process.env.APPDATA || '';
    return path.join(appData, 'Kiro', 'User', 'globalStorage', 'kiro.kiroagent');
  }

  async extract(workspacePath?: string, customScanPaths: string[] = []): Promise<CapturedSession> {
    const sessions = await this.extractAll(workspacePath, customScanPaths);
    return sessions.length > 0 
      ? sessions[0] 
      : { sourceIde: this.ideId, capturedAt: new Date().toISOString(), messages: [], rawPath: this.getProjectsDir(), readStatus: 'empty' };
  }

  async extractAll(workspacePath?: string, customScanPaths: string[] = []): Promise<CapturedSession[]> {
    const projectsDir = this.getProjectsDir();
    const dirsToScan = [...customScanPaths, projectsDir];
    const results: CapturedSession[] = [];

    for (const scanDir of dirsToScan) {
      try {
        await fs.access(scanDir);
        const folders = await fs.readdir(scanDir);

        for (const folder of folders) {
          const folderPath = path.join(scanDir, folder);
          try {
            const s = await fs.stat(folderPath);
            if (!s.isDirectory()) continue;

            const files = await fs.readdir(folderPath);
            const chatFiles = files.filter(f => f.endsWith('.chat'));

            for (const f of chatFiles) {
              const filePath = path.join(folderPath, f);
              try {
                const fsStat = await fs.stat(filePath);
                const raw = await fs.readFile(filePath, 'utf8');
                const messages = this.parseKiroChat(raw);
                if (messages.length > 0) {
                  results.push({
                    sourceIde: this.ideId,
                    capturedAt: new Date(fsStat.mtimeMs).toISOString(),
                    messages,
                    rawPath: filePath,
                    readStatus: 'success',
                  });
                }
              } catch { /* skip */ }
            }
          } catch { /* skip */ }
        }
      } catch {
        continue;
      }
    }

    return results.sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
  }

  private parseKiroChat(raw: string): ChatMessage[] {
    const messages: ChatMessage[] = [];

    try {
      const obj = JSON.parse(raw) as KiroChatFile;
      const chatArr = obj.chat || [];
      if (!Array.isArray(chatArr)) return [];

      for (const msg of chatArr) {
        if (!msg.content || !msg.role) continue;
        const text = msg.content.trim();
        if (!text) continue;

        let role: ChatMessage['role'] = 'assistant';
        if (msg.role === 'human' || msg.role === 'user') role = 'user';
        else if (msg.role === 'tool') role = 'tool';
        else if (msg.role === 'bot' || msg.role === 'assistant') role = 'assistant';

        messages.push({ role, content: text });
      }
    } catch { /* ignore parse error */ }

    return messages;
  }
}
