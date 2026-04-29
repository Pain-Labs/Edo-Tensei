/**
 * CursorExtractor.ts
 *
 * 讀取 Cursor IDE 的 Agent 對話記錄。
 *
 * 儲存路徑：~/.cursor/projects/{project-slug}/agent-transcripts/{uuid}/{uuid}.jsonl
 * project-slug 格式：路徑中的斜線與冒號換成連字號
 *   例如：C:\Users\username\MyProject → c-Users-username-MyProject
 *
 * JSONL 格式：每行一個 JSON 物件，含 role + message.content
 *   {"role":"user","message":{"content":[{"type":"text","text":"..."}]}}
 *   {"role":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
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

  /**
   * Convert a workspace path to the Cursor project slug format.
   * e.g. "C:\Users\username\MyProject" → "c-Users-username-MyProject"
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
        
        for (const project of allProjects) {
          const sessions = await this.extractFromProject(project.path);
          allSessions.push(...sessions);
        }
      } catch {
        continue;
      }
    }
    
    // Sort all sessions by mtime DESC
    return allSessions.sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
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
    try {
      await fs.access(transcriptsDir);
      const uuidDirs = await fs.readdir(transcriptsDir);
      const results: CapturedSession[] = [];

      for (const uuidDir of uuidDirs) {
        const jsonlPath = path.join(transcriptsDir, uuidDir, `${uuidDir}.jsonl`);
        try {
          const s = await fs.stat(jsonlPath);
          if (s.size > 100) {
            const raw = await fs.readFile(jsonlPath, 'utf8');
            const messages = this.parseJsonl(raw);
            if (messages.length > 0) {
              results.push({
                sourceIde: this.ideId,
                capturedAt: new Date(s.mtimeMs).toISOString(),
                workspacePath: projectDir,
                messages,
                rawPath: jsonlPath,
                readStatus: 'success',
              });
            }
          }
        } catch { /* skip */ }
      }
      return results.sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
    } catch {
      return [];
    }
  }

  private parseJsonl(raw: string): ChatMessage[] {
    const messages: ChatMessage[] = [];

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) { continue; }

      try {
        const obj = JSON.parse(trimmed) as CursorJsonlLine;
        if (obj.role !== 'user' && obj.role !== 'assistant') { continue; }

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

    return messages;
  }
}
