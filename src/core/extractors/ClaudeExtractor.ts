import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { CapturedSession, ChatMessage, IChatExtractor } from './types';

type ClaudeContentItem = {
  type?: string;
  text?: string;
  thinking?: string;
  // tool_result items (skip these)
  tool_use_id?: string;
  content?: string;
};

type ClaudeJsonlRecord = {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  uuid?: string;
  message?: {
    role?: string;
    content?: Array<ClaudeContentItem>;
  };
};

export class ClaudeExtractor implements IChatExtractor {
  readonly ideId = 'claude' as const;

  private getScanPaths(): string[] {
    const defaultPath = path.join(os.homedir(), '.claude', 'projects');
    const paths = [defaultPath];
    
    try {
      const customConfig = vscode.workspace.getConfiguration('edoTensei').get<Record<string, string[]>>('customScanPaths') || {};
      const custom = customConfig[this.ideId];
      if (Array.isArray(custom)) {
        paths.push(...custom);
      }
    } catch (e) {
      // Configuration might not be available during testing
    }
    
    return paths;
  }

  async extract(workspacePath?: string): Promise<CapturedSession> {
    const sessions = await this.extractAll(workspacePath);
    return sessions.length > 0
      ? sessions[0]
      : {
          sourceIde: this.ideId,
          capturedAt: new Date().toISOString(),
          messages: [],
          rawPath: this.getScanPaths()[0],
          readStatus: 'empty',
        };
  }

  async extractAll(workspacePath?: string): Promise<CapturedSession[]> {
    const scanPaths = this.getScanPaths();
    const results: CapturedSession[] = [];

    for (const projectsDir of scanPaths) {
      try {
        await fs.access(projectsDir);
      } catch {
        continue; // Skip if directory doesn't exist
      }

      const projectDirs = await this.safeReadDir(projectsDir);
      for (const projectSlug of projectDirs) {
      const projectPath = path.join(projectsDir, projectSlug);
      const st = await this.safeStat(projectPath);
      if (!st?.isDirectory()) continue;

      // Best-effort workspace filtering: only include if slug looks related to the workspace path.
      if (workspacePath && !this.isSlugMatchWorkspace(projectSlug, workspacePath)) {
        continue;
      }

      const entries = await this.safeReadDir(projectPath);
      for (const entry of entries) {
        if (!entry.endsWith('.jsonl')) continue;

        const filePath = path.join(projectPath, entry);
        const fileStat = await this.safeStat(filePath);
        if (!fileStat) continue;

        // Avoid tiny files (usually metadata only)
        if (fileStat.size < 200) continue;

        const raw = await this.safeReadFile(filePath);
        if (!raw) continue;

        const messages = this.parseClaudeJsonl(raw);
        if (messages.length === 0) continue;

        results.push({
          sourceIde: this.ideId,
          capturedAt: new Date(fileStat.mtimeMs).toISOString(),
          sessionId: path.basename(entry, '.jsonl'),
          workspacePath: this.slugToWorkspacePath(projectSlug),
          messages,
          rawPath: filePath,
          readStatus: 'success',
        });
      }
    }
    }

    return results.sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
  }

  private parseClaudeJsonl(raw: string): ChatMessage[] {
    const messages: ChatMessage[] = [];

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let obj: ClaudeJsonlRecord | undefined;
      try {
        obj = JSON.parse(trimmed) as ClaudeJsonlRecord;
      } catch {
        continue;
      }

      // We focus on events that carry message payloads.
      const type = (obj.type || '').toLowerCase();
      if (type !== 'user' && type !== 'assistant') continue;

      const role: ChatMessage['role'] = type === 'user' ? 'user' : 'assistant';

      const contentArr = obj.message?.content ?? [];

      // Collect meaningful text from content items.
      // Claude Code injects IDE context as XML (<ide_opened_file>, etc.) into the
      // first content item. We skip tool_result items and pure-XML items.
      const textParts: string[] = [];
      for (const c of contentArr) {
        if (!c) continue;
        // Skip tool_result type items (they contain raw tool output, not user intent)
        if (c.type === 'tool_result') continue;
        // For text type items: strip XML tags and check if anything meaningful remains
        if (c.type === 'text' || typeof c.text === 'string') {
          const stripped = (c.text || '').replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '').replace(/<[^>]+>/g, '').trim();
          if (stripped.length > 0) {
            textParts.push(stripped);
          }
        } else if (c.type === 'thinking' && typeof c.thinking === 'string') {
          // Keep thinking content for assistant messages
          textParts.push(c.thinking.trim());
        }
      }

      const text = textParts.join('\n').trim();
      if (!text) continue;

      messages.push({
        role,
        content: text,
        timestamp: obj.timestamp,
      });
    }

    return messages;
  }

  private isSlugMatchWorkspace(slug: string, workspacePath: string): boolean {
    const normalizedSlug = slug.toLowerCase();
    const normalizedWs = workspacePath.replace(/\\/g, '-').replace(/\//g, '-').replace(/:/g, '-').toLowerCase();
    return normalizedSlug.includes(normalizedWs);
  }

  private slugToWorkspacePath(slug: string): string | undefined {
    // Claude slug pattern observed:
    //   d--PycharmProjects-myproject
    //   c--Users-username-MyProject
    // This is best-effort and primarily used for grouping/labels.
    const m = slug.match(/^([a-z])--(.+)$/i);
    if (!m) return undefined;
    const drive = m[1].toUpperCase();
    const rest = m[2].replace(/-/g, path.sep);
    return `${drive}:${path.sep}${rest}`;
  }

  private async safeReadDir(dir: string): Promise<string[]> {
    try {
      return await fs.readdir(dir);
    } catch {
      return [];
    }
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
