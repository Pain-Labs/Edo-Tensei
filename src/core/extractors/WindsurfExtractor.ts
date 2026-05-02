/**
 * WindsurfExtractor.ts
 *
 * 讀取 Windsurf (Codeium Cascade) 的對話記錄。
 *
 * 儲存路徑：~/.codeium/windsurf/cascade/{uuid}.pb
 *
 * 格式為 Protobuf。為了不引入額外的 protobuf 編譯依賴，
 * 我們實作一個輕量級的「二進位字串萃取器 (Binary String Extractor)」，
 * 將檔案中長度大於一定字元的 UTF-8 字串直接抓取出來作為對話內容。
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { CapturedSession, ChatMessage, IChatExtractor } from './types';

export class WindsurfExtractor implements IChatExtractor {
  readonly ideId = 'windsurf' as const;

  private getCascadeDir(): string {
    return path.join(os.homedir(), '.codeium', 'windsurf', 'cascade');
  }

  async extract(_workspacePath?: string, customScanPaths: string[] = []): Promise<CapturedSession> {
    const sessions = await this.extractAll(_workspacePath);
    return sessions.length > 0 
      ? sessions[0] 
      : { sourceIde: this.ideId, capturedAt: new Date().toISOString(), messages: [], rawPath: this.getCascadeDir(), readStatus: 'empty' };
  }

  async extractAll(_workspacePath?: string, customScanPaths: string[] = []): Promise<CapturedSession[]> {
    const cascadeDir = this.getCascadeDir();
    const dirsToScan = [...customScanPaths, cascadeDir];
    const results: CapturedSession[] = [];

    for (const scanDir of dirsToScan) {
      try {
        await fs.access(scanDir);
        const files = await fs.readdir(scanDir);
        const pbFiles = files.filter(f => f.endsWith('.pb'));

        // Process all .pb files in parallel
        const fileResults = await Promise.all(
          pbFiles.map(async (f): Promise<CapturedSession | undefined> => {
            const filePath = path.join(scanDir, f);
            try {
              const s = await fs.stat(filePath);
              const buffer = await fs.readFile(filePath);
              const extractedText = this.extractPrintableStrings(buffer);

              const messages: ChatMessage[] = [];
              for (const text of extractedText) {
                if (text.length > 30) {
                  messages.push({ role: 'assistant', content: text.trim() });
                }
              }

              if (messages.length > 0) {
                return {
                  sourceIde: this.ideId,
                  capturedAt: new Date(s.mtimeMs).toISOString(),
                  sessionId: f.replace('.pb', ''),
                  messages,
                  rawPath: filePath,
                  readStatus: 'success',
                };
              }
            } catch { /* skip */ }
            return undefined;
          })
        );

        for (const session of fileResults) {
          if (session) results.push(session);
        }
      } catch {
        continue;
      }
    }

    return results.sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
  }

  /**
   * 簡易的二進位字串萃取機制，尋找連續的可列印 ASCII 或 UTF-8 字元
   */
  private extractPrintableStrings(buffer: Buffer): string[] {
    const strings: string[] = [];
    let currentString: number[] = [];

    for (let i = 0; i < buffer.length; i++) {
      const byte = buffer[i];
      if ((byte >= 0x20 && byte <= 0x7E) || (byte >= 0x09 && byte <= 0x0D) || byte >= 0xA0) {
        currentString.push(byte);
      } else {
        if (currentString.length >= 30) {
          try {
            const str = Buffer.from(currentString).toString('utf8');
            if (this.isHumanText(str)) {
              strings.push(str);
            }
          } catch { /* ignore invalid utf8 */ }
        }
        currentString = [];
      }
    }

    if (currentString.length >= 30) {
      try {
        const str = Buffer.from(currentString).toString('utf8');
        if (this.isHumanText(str)) {
          strings.push(str);
        }
      } catch { /* ignore invalid utf8 */ }
    }

    return strings;
  }

  private isHumanText(str: string): boolean {
    const printableCount = (str.match(/[\x20-\x7E\u4e00-\u9fa5\s\n\t]/g) || []).length;
    const ratio = printableCount / str.length;
    const hasLanguage = /[a-zA-Z\u4e00-\u9fa5]/.test(str);
    const tooManyRepeats = /(.)\1{20,}/.test(str); // 放寬重複字元過濾
    return ratio > 0.6 && hasLanguage && !tooManyRepeats; // 降低可列印字元比例門檻
  }
}
