/**
 * AntigravityExtractor.ts
 *
 * 讀取 Antigravity (Google DeepMind) 的對話記錄。
 *
 * 儲存路徑：
 *   ~\.gemini\antigravity\brain\{uuid}\.system_generated\logs\overview.txt
 *
 * ⚠️ 重要限制（2026-04-27 實測確認）：
 *   overview.txt 是 **preview-only 日誌**，並非完整對話記錄。
 *   每筆訊息的 content 欄位最多保留約 900 chars，超出部分在雲端回傳時即截斷。
 *   截斷標記格式為 `<truncated N bytes>`。
 *   我們保留此標記而不將其隱藏，藉此清楚讓使用者知道對話記錄並不完整。
 *   完整對話記錄存於 Antigravity 雲端，本地不落地。
 *   這已是本地能讀取的最佳方案，待 Antigravity 開放 API 或 export 功能後再升級。
 *
 * overview.txt 格式：每行一個 JSON 物件，type 為 PLANNER_RESPONSE / TOOL_CALL_RESULT 等。
 * 我們只需要 source=USER/USER_EXPLICIT 作為 user，source=MODEL 作為 assistant。
 *
 * 效能策略：
 *   - candidate 蒐集：readdir + stat 全並行（Promise.all）
 *   - 讀取與解析：overview.txt 通常 < 1MB，全部 Promise.all 並行 readFile + parse
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { CapturedSession, ChatMessage, IChatExtractor } from './types';

interface OverviewLine {
  step_index?: number;
  source?: 'USER' | 'MODEL' | 'USER_EXPLICIT' | string;
  type?: string;
  status?: string;
  created_at?: string;
  /** For USER type lines, the input text */
  input?: string;
  /** For MODEL lines with tool_calls, text content */
  tool_calls?: Array<{ name: string; args?: any }>;
  /** For TOOL_CALL_RESULT */
  result?: unknown;
  /** Direct content field (older format) */
  content?: string;
  /** User message text in some versions */
  text?: string;
}

export class AntigravityExtractor implements IChatExtractor {
  readonly ideId = 'antigravity' as const;

  private getBaseDir(): string {
    return path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
  }

  async extract(_workspacePath?: string, customScanPaths: string[] = []): Promise<CapturedSession> {
    const sessions = await this.extractAll(_workspacePath, customScanPaths);
    return sessions.length > 0
      ? sessions[0]
      : { sourceIde: this.ideId, capturedAt: new Date().toISOString(), messages: [], rawPath: this.getBaseDir(), readStatus: 'empty' };
  }

  async extractAll(_workspacePath?: string, customScanPaths: string[] = []): Promise<CapturedSession[]> {
    const baseDir = this.getBaseDir();
    const dirsToScan = [...customScanPaths, baseDir];

    // Step 1: Collect all candidate overview.txt paths in parallel across all scan dirs
    const candidateArrays = await Promise.all(
      dirsToScan.map(async (scanDir): Promise<Array<{ path: string; uuid: string; mtime: number }>> => {
        try {
          await fs.access(scanDir);
          const brainIds = await fs.readdir(scanDir);

          // Stat all overview.txt files in parallel
          const candidates = await Promise.all(
            brainIds.map(async (id): Promise<{ path: string; uuid: string; mtime: number; size: number } | undefined> => {
              const overviewPath = path.join(scanDir, id, '.system_generated', 'logs', 'overview.txt');
              try {
                const s = await fs.stat(overviewPath);
                return { path: overviewPath, uuid: id, mtime: s.mtimeMs, size: s.size };
              } catch {
                return undefined;
              }
            })
          );

          return candidates.filter((c): c is { path: string; uuid: string; mtime: number; size: number } => c !== undefined);
        } catch {
          return [];
        }
      })
    );

    const allCandidates = candidateArrays.flat();
    if (allCandidates.length === 0) return [];

    // Step 2: Read and parse all overview.txt files in parallel
    const sessionResults = await Promise.all(
      allCandidates.map(async (cand): Promise<CapturedSession | undefined> => {
        try {
          const raw = await fs.readFile(cand.path, 'utf8');
          const { messages, hasTruncation } = this.parseOverview(raw);
          if (messages.length > 0) {
            return {
              sourceIde: this.ideId,
              capturedAt: new Date(cand.mtime).toISOString(),
              sessionId: cand.uuid,
              messages,
              fileSizeBytes: cand.size,
              rawPath: cand.path,
              // 若原始日誌有截斷標記，記錄於 readStatus（overview.txt 的設計即為 preview-only）
              readStatus: hasTruncation ? 'success' : 'success',
              errorDetail: hasTruncation ? 'overview.txt is preview-only; some messages are truncated at source' : undefined,
            };
          }
        } catch { /* skip */ }
        return undefined;
      })
    );

    const results = sessionResults.filter((s): s is CapturedSession => s !== undefined);
    return results.sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
  }

  private parseOverview(raw: string): { messages: ChatMessage[]; hasTruncation: boolean } {
    const messages: ChatMessage[] = [];
    let hasTruncation = false;

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) { continue; }

      try {
        const obj = JSON.parse(trimmed) as OverviewLine;

        // User messages
        if ((obj.source === 'USER' || obj.source === 'USER_EXPLICIT') && (obj.input || obj.content || obj.text)) {
          let content = obj.input || obj.content || obj.text || '';
          // 偵測 Antigravity overview.txt 的截斷標記，但不將其隱藏
          const truncMatch = content.match(/<truncated \d+ bytes>\s*$/);
          if (truncMatch) {
            hasTruncation = true;
          }
          if (content.trim()) {
            messages.push({
              role: 'user',
              content: content.trim(),
              timestamp: obj.created_at,
            });
          }
        }
        // Model messages
        else if (obj.source === 'MODEL' && obj.type === 'PLANNER_RESPONSE') {
          // Case 1: Direct content
          if (obj.content || obj.text) {
             let content = obj.content || obj.text || '';
             // 偵測 Antigravity overview.txt 的截斷標記，但不將其隱藏
             const truncMatch = content.match(/<truncated \d+ bytes>\s*$/);
             if (truncMatch) {
               hasTruncation = true;
             }
             if (content.trim()) {
               messages.push({ role: 'assistant', content: content.trim(), timestamp: obj.created_at });
             }
          }
          // Case 2: Tool calls (common in Agent mode)
          else if (obj.tool_calls) {
            for (const tc of obj.tool_calls) {
              if (tc.name === 'reply' || tc.name === 'respond' || tc.name === 'send_message' || tc.name === 'answer') {
                const content = typeof tc.args?.content === 'string' ? tc.args.content :
                                typeof tc.args?.message === 'string' ? tc.args.message :
                                typeof tc.args?.text === 'string' ? tc.args.text : '';
                if (content.trim()) {
                  messages.push({ role: 'assistant', content: content.trim(), timestamp: obj.created_at });
                }
              }
            }
          }
        }
      } catch { /* skip malformed lines */ }
    }

    return { messages, hasTruncation };
  }
}
