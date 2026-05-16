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
            fileSizeBytes: st.size,
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

        // IDE context messages embed user input under "## My request for Codex:"
        // Extract only that section; skip the message entirely if no request is present.
        if (role === 'user' && text.trimStart().startsWith('# Context from my IDE setup:')) {
          const marker = '## My request for Codex:';
          const idx = text.indexOf(marker);
          if (idx !== -1) {
            const requestText = text.slice(idx + marker.length).trim();
            if (requestText) {
              messages.push({ role: 'user', content: requestText, timestamp: obj.timestamp });
            }
          }
          continue;
        }

        // Skip Codex-injected system messages (permissions, collaboration mode, skills, env context, AGENTS.md)
        if (this.isCodexInjectedMessage(role, text)) continue;

        // Map developer/system to system to reduce noise in the tree view (still kept in transcript).
        const mappedRole: ChatMessage['role'] = role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'system';
        messages.push({ role: mappedRole, content: text, timestamp: obj.timestamp });
      }
    }

    return { messages, cwd, sessionId };
  }

  /**
   * Codex 會把以下內容注入為 user/system message，這些不是真正的使用者輸入：
   *   - <permissions instructions>...</permissions instructions>  （沙盒規則）
   *   - <collaboration_mode>...</collaboration_mode>             （Plan/Default mode 設定）
   *   - <skills_instructions>...</skills_instructions>           （Skill 清單注入）
   *   - <environment_context>...</environment_context>           （cwd/shell/date 等）
   *   - # AGENTS.md instructions for ...                        （AGENTS.md 全文注入）
   * 若訊息**幾乎只有**這些 XML 標籤，則視為注入訊息，不納入對話歷史。
   */
  private isCodexInjectedMessage(role: string, text: string): boolean {
    // developer/system role 全部都是 Codex 系統注入，直接過濾
    if (role === 'developer' || role === 'system') return true;

    const stripped = text.trimStart();

    // 以下訊息永遠是純注入（不含使用者輸入），直接過濾
    if (stripped.startsWith('<turn_aborted>')) return true;

    // user role：檢查是否以 Codex 注入的標籤開頭（且使用者真正輸入的文字極少）
    const INJECTED_PREFIXES = [
      '<permissions instructions>',
      '<collaboration_mode>',
      '<skills_instructions>',
      '<environment_context>',
      '# AGENTS.md instructions for',
    ];

    if (INJECTED_PREFIXES.some(p => stripped.startsWith(p))) {
      // 若整段文字都在標籤區塊裡，確認沒有夾雜真正的使用者輸入
      // 策略：移除已知 Codex 注入區塊，再以字元層級清掉尖括號，避免多字元 sanitizer 重組出標籤。
      const withoutTags = this.stripCodexInjectedScaffolding(text);
      return withoutTags.length < 50;
    }

    return false;
  }

  private stripCodexInjectedScaffolding(text: string): string {
    const blocks: Array<[string, string]> = [
      ['<permissions instructions>', '</permissions instructions>'],
      ['<collaboration_mode>', '</collaboration_mode>'],
      ['<skills_instructions>', '</skills_instructions>'],
      ['<environment_context>', '</environment_context>'],
    ];

    let result = text;
    for (const [openTag, closeTag] of blocks) {
      result = this.removeMarkedBlocks(result, openTag, closeTag);
    }

    return result
      .split(/\r?\n/)
      .filter(line => !line.trimStart().startsWith('# AGENTS.md instructions for'))
      .join('\n')
      .replace(/[<>]/g, '')
      .trim();
  }

  private removeMarkedBlocks(text: string, openMarker: string, closeMarker: string): string {
    let result = '';
    let cursor = 0;
    const lowerText = text.toLowerCase();
    const lowerOpen = openMarker.toLowerCase();
    const lowerClose = closeMarker.toLowerCase();

    while (cursor < text.length) {
      const start = lowerText.indexOf(lowerOpen, cursor);
      if (start === -1) {
        result += text.slice(cursor);
        break;
      }

      result += text.slice(cursor, start);
      const closeStart = lowerText.indexOf(lowerClose, start + openMarker.length);
      if (closeStart === -1) {
        break;
      }

      cursor = closeStart + closeMarker.length;
    }

    return result;
  }

  private async findRolloutFiles(root: string): Promise<string[]> {
    const walk = async (dir: string, depth: number): Promise<string[]> => {
      if (depth > 5) return [];
      let entries: import('fs').Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return [];
      }

      // Process all entries in parallel
      const childResults = await Promise.all(
        entries.map(async (e): Promise<string[]> => {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            return walk(full, depth + 1);
          } else if (e.isFile()) {
            const lower = e.name.toLowerCase();
            if (lower.startsWith('rollout-') && lower.endsWith('.jsonl')) {
              return [full];
            }
          }
          return [];
        })
      );

      return childResults.flat();
    };

    return walk(root, 0);
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
