/**
 * CursorExtractor.ts
 *
 * 讀取 Cursor IDE 的 Agent 對話記錄。
 *
 * 儲存路徑：~/.cursor/projects/{project-slug}/agent-transcripts/{uuid}/{uuid}.jsonl
 * project-slug 格式：路徑中的斜線與冒號換成連字號
 *   例如：C:\\Users\\username\\MyProject → c-Users-username-MyProject
 *
 * JSONL 格式：每行一個 JSON 物件，含 role + message.content
 *   {"role":"user","message":{"content":[{"type":"text","text":"..."}]}}
 *   {"role":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
 *
 * Lazy Loading 策略：
 *   - Pre-scan：readFile + split('\n')，只解析第一行含 role=user 的 JSON，不掃完整檔案
 *   - 兩層 loop 全改 Promise.all()：project dirs & uuid dirs 全部並行
 *   - loadFullMessages()：readline streaming，逐行解析完整對話
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as readline from 'readline';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { CapturedSession, ChatMessage, IChatExtractor } from './types';

interface CursorJsonlLine {
  role: 'user' | 'assistant';
  message?: {
    content?: Array<{ type: string; text?: string }>;
  };
}

export class CursorExtractor implements IChatExtractor {
  readonly ideId = 'cursor' as const;

  private getProjectsDir(): string {
    return path.join(os.homedir(), '.cursor', 'projects');
  }

  private isLazyEnabled(): boolean {
    try {
      return vscode.workspace.getConfiguration('edoTensei').get<boolean>('lazyLoadMessages', true);
    } catch {
      return true;
    }
  }

  /**
   * Convert a workspace path to the Cursor project slug format.
   * e.g. "C:\\Users\\username\\MyProject" → "c-Users-username-MyProject"
   */
  private pathToSlug(workspacePath: string): string {
    return workspacePath
      .replace(/^([A-Za-z]):/, (_, drive) => drive.toLowerCase()) // lowercase drive
      .replace(/[/\\:]/g, '-');                                    // slashes/colons → dash
  }

  async extract(workspacePath?: string, customScanPaths: string[] = []): Promise<CapturedSession> {
    const projectsDir = this.getProjectsDir();

    try {
      await fs.access(projectsDir);
    } catch {
      return { sourceIde: this.ideId, capturedAt: new Date().toISOString(), messages: [], rawPath: projectsDir, readStatus: 'not_found' };
    }

    // Find the project directory
    let targetProjectDir: string | undefined;

    if (workspacePath) {
      const slug = this.pathToSlug(workspacePath);
      const candidate = path.join(projectsDir, slug);
      try {
        await fs.access(candidate);
        targetProjectDir = candidate;
      } catch {
        // fall through
      }
    }

    // If not found by slug, do NOT fall back to latest project IF workspacePath was provided.
    if (!targetProjectDir && workspacePath) {
      return { sourceIde: this.ideId, capturedAt: new Date().toISOString(), messages: [], rawPath: projectsDir, readStatus: 'empty' };
    }

    // Only if NO workspacePath was provided at all, fall back to most recently modified project
    if (!targetProjectDir) {
      const allProjects = await this.listAllProjects(projectsDir);
      if (allProjects.length > 0) {
        targetProjectDir = allProjects[0].path;
      }
    }

    if (!targetProjectDir) {
      return { sourceIde: this.ideId, capturedAt: new Date().toISOString(), messages: [], rawPath: projectsDir, readStatus: 'empty' };
    }

    const sessions = await this.extractFromProject(targetProjectDir);
    return sessions.length > 0
      ? sessions[0]
      : { sourceIde: this.ideId, capturedAt: new Date().toISOString(), messages: [], rawPath: targetProjectDir, readStatus: 'empty' };
  }

  async extractAll(_workspacePath?: string, customScanPaths: string[] = []): Promise<CapturedSession[]> {
    const defaultDir = this.getProjectsDir();
    const dirsToScan = [...customScanPaths, defaultDir];
    const allSessions: CapturedSession[] = [];

    for (const projectsDir of dirsToScan) {
      try {
        await fs.access(projectsDir);
        const allProjects = await this.listAllProjects(projectsDir);

        // Process all projects in parallel
        const projectResults = await Promise.all(
          allProjects.map(project => this.extractFromProject(project.path))
        );

        for (const sessions of projectResults) {
          allSessions.push(...sessions);
        }
      } catch {
        continue;
      }
    }

    // Sort all sessions by mtime DESC
    return allSessions.sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
  }

  async loadFullMessages(session: CapturedSession): Promise<void> {
    if (session.messagesLoaded) return;

    const messages = await this.parseJsonlFull(session.rawPath);
    session.messages = messages;
    session.messagesLoaded = true;
  }

  private async listAllProjects(projectsDir: string): Promise<Array<{ name: string; path: string; mtime: number }>> {
    try {
      const entries = await fs.readdir(projectsDir);
      const statsArr = await Promise.all(
        entries.map(async e => {
          try {
            const p = path.join(projectsDir, e);
            const s = await fs.stat(p);
            return { name: e, path: p, mtime: s.mtimeMs };
          } catch {
            return null;
          }
        })
      );
      return (statsArr.filter(x => x !== null) as any[]).sort((a, b) => b.mtime - a.mtime);
    } catch {
      return [];
    }
  }

  private async extractFromProject(projectDir: string): Promise<CapturedSession[]> {
    const transcriptsDir = path.join(projectDir, 'agent-transcripts');
    const lazy = this.isLazyEnabled();

    try {
      await fs.access(transcriptsDir);
      const uuidDirs = await fs.readdir(transcriptsDir);

      // Process all uuid dirs in parallel
      const results = await Promise.all(
        uuidDirs.map(async (uuidDir): Promise<CapturedSession | undefined> => {
          const jsonlPath = path.join(transcriptsDir, uuidDir, `${uuidDir}.jsonl`);
          try {
            const s = await fs.stat(jsonlPath);
            if (s.size < 100) return undefined;

            if (lazy) {
              const firstMsg = await this.prescanFirstUserMessage(jsonlPath);
              return {
                sourceIde: this.ideId,
                capturedAt: new Date(s.mtimeMs).toISOString(),
                sessionId: uuidDir,
                workspacePath: projectDir,
                messages: firstMsg ? [firstMsg] : [],
                messagesLoaded: false,
                fileSizeBytes: s.size,
                metadata: { lazyScanned: true },
                rawPath: jsonlPath,
                readStatus: 'success',
              };
            } else {
              const messages = await this.parseJsonlFull(jsonlPath);
              if (messages.length > 0) {
                return {
                  sourceIde: this.ideId,
                  capturedAt: new Date(s.mtimeMs).toISOString(),
                  sessionId: uuidDir,
                  workspacePath: projectDir,
                  messages,
                  messagesLoaded: true,
                  fileSizeBytes: s.size,
                  rawPath: jsonlPath,
                  readStatus: 'success',
                };
              }
            }
          } catch { /* skip */ }
          return undefined;
        })
      );

      const valid = results.filter((s): s is CapturedSession => s !== undefined);
      return valid.sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
    } catch {
      return [];
    }
  }

  /**
   * Pre-scan: 逐行掃描 JSONL，找到第一條 role=user 的訊息即返回，不讀完整檔案。
   */
  private async prescanFirstUserMessage(jsonlPath: string): Promise<ChatMessage | undefined> {
    const stream = fsSync.createReadStream(jsonlPath, { encoding: 'utf8', highWaterMark: 65536 });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    try {
      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const obj = JSON.parse(trimmed) as CursorJsonlLine;
          if (obj.role !== 'user') continue;

          const text = (obj.message?.content ?? [])
            .filter(c => c.type === 'text' && c.text)
            .map(c => c.text ?? '')
            .join('\n')
            .trim();

          if (text) {
            rl.close();
            stream.destroy();
            return { role: 'user', content: text };
          }
        } catch { /* skip malformed lines */ }
      }
    } catch { /* ignore stream errors */ }

    return undefined;
  }

  /**
   * Full load: readline streaming，逐行解析完整對話（避免大檔 OOM）。
   */
  private async parseJsonlFull(jsonlPath: string): Promise<ChatMessage[]> {
    const messages: ChatMessage[] = [];

    const stream = fsSync.createReadStream(jsonlPath, { encoding: 'utf8', highWaterMark: 65536 });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    try {
      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const obj = JSON.parse(trimmed) as CursorJsonlLine;
          if (obj.role !== 'user' && obj.role !== 'assistant') continue;

          const text = (obj.message?.content ?? [])
            .filter(c => c.type === 'text' && c.text)
            .map(c => c.text ?? '')
            .join('\n')
            .trim();

          if (text) {
            messages.push({ role: obj.role, content: text });
          }
        } catch { /* skip malformed lines */ }
      }
    } catch { /* ignore stream errors */ }

    return messages;
  }
}
