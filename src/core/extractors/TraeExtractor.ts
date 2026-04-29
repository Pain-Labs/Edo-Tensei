/**
 * TraeExtractor.ts
 *
 * 讀取 Trae (ByteDance/Alibaba) 的對話記錄。
 *
 * 儲存路徑：%APPDATA%\Trae\User\globalStorage\.ckg\storage\{hash}\*_codekg.db
 *
 * 由於 Trae 使用 SQLite，為了避免在 VS Code extension 中引入
 * native node-sqlite3 編譯依賴，這裡實作一個輕量的「二進位字串萃取器」，
 * 直接從 `.db` 檔案中掃描提取出人類可讀的對話內容（因為 SQLite 的文字欄位以 UTF-8 儲存）。
 * TODO: Fix garbled output (encoding issue). Currently disabled in SessionHandoffService.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { CapturedSession, ChatMessage, IChatExtractor } from './types';

export class TraeExtractor implements IChatExtractor {
  readonly ideId = 'trae' as const;

  private getStorageDir(): string {
    const appData = process.env.APPDATA || '';
    return path.join(appData, 'Trae', 'User', 'globalStorage', '.ckg', 'storage');
  }

  async extract(workspacePath?: string): Promise<CapturedSession> {
    const storageDir = this.getStorageDir();

    try {
      await fs.access(storageDir);
    } catch {
      return { sourceIde: this.ideId, capturedAt: new Date().toISOString(), messages: [], rawPath: storageDir, readStatus: 'not_found' };
    }

    try {
      const hashDirs = await fs.readdir(storageDir);
      const candidates: Array<{ filePath: string; mtime: number }> = [];

      for (const dir of hashDirs) {
        const fullDirPath = path.join(storageDir, dir);
        try {
          const stat = await fs.stat(fullDirPath);
          if (!stat.isDirectory()) continue;

          const files = await fs.readdir(fullDirPath);
          for (const file of files) {
            if (file.endsWith('_codekg.db')) {
              const filePath = path.join(fullDirPath, file);
              const fStat = await fs.stat(filePath);
              candidates.push({ filePath, mtime: fStat.mtimeMs });
            }
          }
        } catch { /* skip inaccessible dirs */ }
      }

      if (candidates.length === 0) {
        return { sourceIde: this.ideId, capturedAt: new Date().toISOString(), messages: [], rawPath: storageDir, readStatus: 'empty' };
      }

      // 找出最近更新的 .db 檔
      candidates.sort((a, b) => b.mtime - a.mtime);
      const latestDbPath = candidates[0].filePath;

      const buffer = await fs.readFile(latestDbPath);
      const extractedText = this.extractPrintableStrings(buffer);

      const messages: ChatMessage[] = [];
      for (const text of extractedText) {
        if (text.length > 50) { // 過濾掉太短的雜訊
          messages.push({
            role: 'assistant', // 無法精確區分 user/assistant，統一列為對話脈絡
            content: text.trim()
          });
        }
      }

      return {
        sourceIde: this.ideId,
        capturedAt: new Date().toISOString(),
        messages,
        rawPath: latestDbPath,
        readStatus: messages.length > 0 ? 'success' : 'empty',
      };
    } catch (err) {
      return { sourceIde: this.ideId, capturedAt: new Date().toISOString(), messages: [], rawPath: storageDir, readStatus: 'error', errorDetail: String(err) };
    }
  }

  async extractAll(_workspacePath?: string): Promise<CapturedSession[]> {
    // TODO: Implement Trae history extraction
    return [];
  }

  private extractPrintableStrings(buffer: Buffer): string[] {
    const strings: string[] = [];
    let currentString: number[] = [];

    for (let i = 0; i < buffer.length; i++) {
      const byte = buffer[i];
      if ((byte >= 0x20 && byte <= 0x7E) || byte >= 0xA0 || byte === 0x0A || byte === 0x0D) {
        currentString.push(byte);
      } else {
        if (currentString.length >= 30) {
          try {
            const str = Buffer.from(currentString).toString('utf8');
            if (/[a-zA-Z\u4e00-\u9fa5]/.test(str)) {
              strings.push(str);
            }
          } catch { /* ignore */ }
        }
        currentString = [];
      }
    }

    return strings;
  }
}
