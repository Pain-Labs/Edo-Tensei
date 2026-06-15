/**
 * CopilotExtractor.ts
 *
 * 讀取 VS Code GitHub Copilot Chat 的歷史記錄。
 *
 * 儲存路徑：
 *   Windows:          %APPDATA%/Code/User/globalStorage/emptyWindowChatSessions/
 *   Linux/macOS:      ~/.config/Code/User/globalStorage/emptyWindowChatSessions/
 *   VS Code Server:   ~/.vscode-server/data/User/globalStorage/emptyWindowChatSessions/
 * 格式：每個 session 一個 .json 或 .jsonl 檔案
 *   - .json：舊版格式，根層級有 `requests[]`，每個 request 有 message (user) + response[] (assistant)
 *   - .jsonl：新版格式，每行一個 JSON 物件，可含多個 session 或同一 session 的多次快照
 *
 * Lazy Loading 策略（解決 127MB 巨型檔 OOM + 速度問題）：
 *   - Pre-scan：readline 逐行 + regex 快速提取 sessionId 與第一句 user message，不做 JSON.parse
 *   - loadFullMessages()：readline streaming 找對應 session，最後一筆勝（最完整快照）
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as readline from 'readline';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
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

interface CopilotSessionFileCandidate {
  filePath: string;
  workspacePath?: string;
  mtimeMs: number;
  size: number;
}

// ─── JSONL types ───────────────────────────────────────────────────────────────

// 舊版格式：kind=0 的快照行，v 直接是 CopilotSession
interface CopilotJsonlLine {
  kind?: number;  // 0 = full snapshot, 1 = partial update, 2 = array patch
  k?: string | string[];  // 新版：目標 key path（e.g. "requests" or ["requests", 0, "response"]）
  v?: CopilotSession | CopilotRequest[] | unknown;  // 新版：v 的類型視 k 而定
}

export class CopilotExtractor implements IChatExtractor {
  readonly ideId = 'copilot' as const;
  readonly supportsPagedExtraction = true;

  private async tryResolveWorkspaceFileFolders(workspaceFilePath: string): Promise<string[]> {
    try {
      const raw = (await fs.readFile(workspaceFilePath, 'utf8')).replace(/^﻿/, '');
      // .code-workspace 通常是 JSONC（含 // 註解），標準 JSON.parse 會失敗
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        const stripped = raw.replace(/\/\/[^\n]*/g, '');
        parsed = JSON.parse(stripped);
      }
      const baseDir = path.dirname(workspaceFilePath);
      const folders = Array.isArray(parsed?.folders) ? parsed.folders : [];

      const resolved: string[] = [];
      for (const f of folders) {
        const p = f?.path;
        if (typeof p !== 'string' || !p) { continue; }
        const abs = path.isAbsolute(p) ? p : path.resolve(baseDir, p);
        resolved.push(abs);
      }
      return resolved;
    } catch {
      return [];
    }
  }

  private getVSCodeUserDirs(): string[] {
    const dirs: string[] = [];
    const home = os.homedir();
    const appData = process.env.APPDATA;

    // APPDATA may be set by tests or custom launches on non-Windows hosts.
    // Honor it first so fixture scans do not depend on the current platform.
    if (appData) {
      dirs.push(path.join(appData, 'Code', 'User'));
    }

    if (process.platform === 'win32') {
      // Windows VS Code stores user data under APPDATA; without it there is no
      // reliable default equivalent to the XDG paths below.
    } else if (process.platform === 'darwin') {
      dirs.push(path.join(home, 'Library', 'Application Support', 'Code', 'User'));
      dirs.push(path.join(home, 'Library', 'Application Support', 'Code - Insiders', 'User'));
      dirs.push(path.join(home, '.vscode-server', 'data', 'User'));
    } else {
      dirs.push(path.join(home, '.config', 'Code', 'User'));
      dirs.push(path.join(home, '.vscode-server', 'data', 'User'));
      dirs.push(path.join(home, '.vscode-server-insiders', 'data', 'User'));
    }

    return dirs;
  }

  private getBaseDirs(): string[] {
    return this.getVSCodeUserDirs().map(d =>
      path.join(d, 'globalStorage', 'emptyWindowChatSessions')
    );
  }

  private getWorkspaceStorageDirs(): string[] {
    return this.getVSCodeUserDirs().map(d => path.join(d, 'workspaceStorage'));
  }

  private isLazyEnabled(): boolean {
    try {
      return vscode.workspace.getConfiguration('edoTensei').get<boolean>('lazyLoadMessages', true);
    } catch { return true; }
  }

  private async safeStat(p: string): Promise<import('fs').Stats | undefined> {
    try { return await fs.stat(p); } catch { return undefined; }
  }

  private async safeReadFile(p: string): Promise<string | undefined> {
    try { return await fs.readFile(p, 'utf8'); } catch { return undefined; }
  }

  async extract(workspacePath?: string, customScanPaths: string[] = []): Promise<CapturedSession> {
    const emptyWindowDirs = this.getBaseDirs();
    const workspaceStorageDirs = this.getWorkspaceStorageDirs();
    const emptyWindowDir = emptyWindowDirs[0] ?? '';

    let targetDirs: string[] = [...customScanPaths, ...emptyWindowDirs];

    if (workspacePath) {
      for (const workspaceStorageDir of workspaceStorageDirs) {
        try {
          const entries = await fs.readdir(workspaceStorageDir);
          const stats = await this.listDirsByMtime(workspaceStorageDir, entries);

          for (const { name } of stats.slice(0, 30)) {
            const wsJsonPath = path.join(workspaceStorageDir, name, 'workspace.json');
            try {
              const content = (await fs.readFile(wsJsonPath, 'utf8')).replace(/^﻿/, '');
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
    }

    for (const dir of targetDirs) {
      const sessions = await this.extractFromDir(dir);
      if (sessions.length > 0) return sessions[0];
    }

    return { sourceIde: this.ideId, capturedAt: new Date().toISOString(), messages: [], rawPath: emptyWindowDir, readStatus: 'empty' };
  }

  async extractAll(
    _workspacePath?: string,
    customScanPaths: string[] = [],
    options: { limit?: number; offset?: number } = {}
  ): Promise<CapturedSession[]> {
    const offset = Math.max(0, options.offset ?? 0);
    const limit = options.limit === undefined ? undefined : Math.max(0, options.limit);
    const candidates = await this.collectSessionFileCandidates(
      _workspacePath,
      customScanPaths,
      limit === undefined ? undefined : offset + limit
    );
    const selected = limit === undefined
      ? candidates.slice(offset)
      : candidates.slice(offset, offset + limit);

    return this.extractFromCandidates(selected, limit !== undefined);
  }

  private async collectSessionFileCandidates(
    workspacePath?: string,
    customScanPaths: string[] = [],
    maxCandidates?: number
  ): Promise<CopilotSessionFileCandidate[]> {
    // Phase 1: emptyWindowChatSessions — global sessions with no workspace association.
    const globalCandidates: CopilotSessionFileCandidate[] = [];
    for (const dir of [...customScanPaths, ...this.getBaseDirs()]) {
      const limit = maxCandidates === undefined ? undefined : Math.max(0, maxCandidates - globalCandidates.length);
      if (maxCandidates !== undefined && limit === 0) break;
      globalCandidates.push(...await this.collectFilesFromDir(dir, undefined, limit));
    }

    // Phase 2: workspaceStorage — workspace-specific sessions with proper workspacePath.
    // Always runs independently of Phase 1 so that workspace-associated sessions are never
    // crowded out by the global cap.
    const workspaceCandidates: CopilotSessionFileCandidate[] = [];
    for (const workspaceStorageDir of this.getWorkspaceStorageDirs()) {
      try {
        const rawEntries = await fs.readdir(workspaceStorageDir);

        // Pre-filter: stat each dir and check chatSessions existence in parallel batches.
        // Batching at 50 keeps I/O concurrency reasonable while being far faster than
        // the old approach of statting all dirs first then sequentially access-checking them.
        const BATCH = 50;
        const relevantDirs: Array<{ name: string; mtime: number }> = [];
        for (let bi = 0; bi < rawEntries.length; bi += BATCH) {
          const batch = rawEntries.slice(bi, bi + BATCH);
          const batchResults = await Promise.all(
            batch.map(async name => {
              const entryDir = path.join(workspaceStorageDir, name);
              try {
                const [dirStat] = await Promise.all([
                  fs.stat(entryDir),
                  fs.access(path.join(entryDir, 'chatSessions')),
                ]);
                return { name, mtime: dirStat.mtimeMs };
              } catch {
                return null;
              }
            })
          );
          for (const r of batchResults) if (r) relevantDirs.push(r);
        }
        relevantDirs.sort((a, b) => b.mtime - a.mtime);

        for (const { name } of relevantDirs) {
          const entryDir = path.join(workspaceStorageDir, name);
          let resolvedWsPath: string | undefined;
          let resolvedFolderPaths: string[] = [];

          try {
            const wsJsonPath = path.join(entryDir, 'workspace.json');
            const content = (await fs.readFile(wsJsonPath, 'utf8')).replace(/^﻿/, '');
            const wsJson = JSON.parse(content);
            const folderUri = wsJson.folder || wsJson.workspace;
            if (folderUri && typeof folderUri === 'string') {
              resolvedWsPath = decodeURIComponent(folderUri).replace(/^file:\/\/\//, '').replace(/\//g, path.sep);

              if (resolvedWsPath.toLowerCase().endsWith('.code-workspace')) {
                resolvedFolderPaths = await this.tryResolveWorkspaceFileFolders(resolvedWsPath);
              }
            }
          } catch { /* skip */ }

          if (workspacePath && resolvedWsPath) {
            const search = workspacePath.replace(/\\/g, '/').toLowerCase();
            const target = resolvedWsPath.replace(/\\/g, '/').toLowerCase();
            if (!target.includes(search) && !search.includes(target)) {
              if (resolvedFolderPaths.length === 0) {
                continue;
              }
              const folderMatched = resolvedFolderPaths.some(fp => {
                const t = fp.replace(/\\/g, '/').toLowerCase();
                return t.includes(search) || search.includes(t);
              });
              if (!folderMatched) {
                continue;
              }
            }
          }

          let wsPathForSession: string | undefined = resolvedWsPath;
          if (resolvedFolderPaths.length > 0) {
            wsPathForSession = workspacePath ?? resolvedFolderPaths[0];
          }

          workspaceCandidates.push(...await this.collectFilesFromDir(
            path.join(entryDir, 'chatSessions'),
            wsPathForSession,
            maxCandidates === undefined ? undefined : Math.max(0, maxCandidates - workspaceCandidates.length)
          ));

          if (maxCandidates !== undefined && workspaceCandidates.length >= maxCandidates) {
            break;
          }
        }
      } catch { /* skip */ }
    }

    // Merge both sources, sort by recency, and apply the global cap.
    const all = [...workspaceCandidates, ...globalCandidates];
    all.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return maxCandidates === undefined ? all : all.slice(0, maxCandidates);
  }

  private async collectFilesFromDir(
    dir: string,
    wsPath?: string,
    limit?: number
  ): Promise<CopilotSessionFileCandidate[]> {
    try {
      await fs.access(dir);
      const entries = await fs.readdir(dir);
      const files = entries.filter(e => e.endsWith('.json') || e.endsWith('.jsonl'));
      const candidates: CopilotSessionFileCandidate[] = [];
      const STAT_BATCH = 64;

      for (let i = 0; i < files.length; i += STAT_BATCH) {
        const batch = files.slice(i, i + STAT_BATCH);
        const batchStats = await Promise.all(batch.map(async f => {
          const filePath = path.join(dir, f);
          try {
            const stat = await fs.stat(filePath);
            if (stat.size < 500) {
              return undefined;
            }
            return {
              filePath,
              workspacePath: wsPath,
              mtimeMs: stat.mtimeMs,
              size: stat.size,
            } satisfies CopilotSessionFileCandidate;
          } catch {
            return undefined;
          }
        }));
        for (const candidate of batchStats) {
          if (candidate) {
            candidates.push(candidate);
          }
        }
      }

      candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
      return limit === undefined ? candidates : candidates.slice(0, limit);
    } catch {
      return [];
    }
  }

  private async extractFromCandidates(candidates: CopilotSessionFileCandidate[], metadataOnly = false): Promise<CapturedSession[]> {
    const results: CapturedSession[] = [];
    const lazy = this.isLazyEnabled();
    const CHUNK_SIZE = 20;

    for (let i = 0; i < candidates.length; i += CHUNK_SIZE) {
      const chunk = candidates.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map(async (candidate) => {
        const ext = path.extname(candidate.filePath).toLowerCase();
        try {
          if (lazy && metadataOnly) {
            results.push({
              sourceIde: this.ideId,
              capturedAt: new Date(candidate.mtimeMs).toISOString(),
              workspacePath: candidate.workspacePath,
              messages: [],
              messagesLoaded: false,
              fileSizeBytes: candidate.size,
              rawPath: candidate.filePath,
              readStatus: 'success',
            });
            return;
          }

          if (lazy) {
            const prescanResult = ext === '.jsonl'
              ? await this.prescanJsonl(candidate.filePath)
              : await this.prescanJson(candidate.filePath);

            for (const p of prescanResult) {
              if (!p.sessionId && !p.firstMsg) continue;
              results.push({
                sourceIde: this.ideId,
                capturedAt: new Date(candidate.mtimeMs).toISOString(),
                sessionId: p.sessionId || path.basename(candidate.filePath, ext),
                title: p.title,
                workspacePath: candidate.workspacePath,
                messages: p.firstMsg ? [p.firstMsg] : [],
                messagesLoaded: false,
                fileSizeBytes: candidate.size,
                metadata: { fileSessionId: p.sessionId },
                rawPath: candidate.filePath,
                readStatus: 'success',
              });
            }
            return;
          }

          const raw = await fs.readFile(candidate.filePath, 'utf8');
          const sessions: CopilotSession[] = [];

          if (ext === '.jsonl') {
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
            try { sessions.push(JSON.parse(raw) as CopilotSession); } catch { /* skip */ }
          }

          for (const session of sessions) {
            if (session?.requests?.length) {
              const messages = this.parseMessages(session.requests);
              if (messages.length > 0) {
                results.push({
                  sourceIde: this.ideId,
                  capturedAt: new Date(candidate.mtimeMs).toISOString(),
                  sessionId: session.sessionId || path.basename(candidate.filePath, ext),
                  title: session.customTitle,
                  workspacePath: candidate.workspacePath,
                  messages,
                  messagesLoaded: true,
                  fileSizeBytes: candidate.size,
                  rawPath: candidate.filePath,
                  readStatus: 'success',
                });
              }
            }
          }
        } catch { /* skip */ }
      }));
    }

    return results.sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
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

  private async extractFromDir(dir: string, wsPath?: string, limit?: number): Promise<CapturedSession[]> {
    try {
      await fs.access(dir);
      const entries = await fs.readdir(dir);
      let files = entries.filter(e => e.endsWith('.json') || e.endsWith('.jsonl'));

      if (limit !== undefined && files.length > limit) {
        const STAT_BATCH = 32;
        const withMtime: Array<{ name: string; mtime: number }> = [];
        for (let si = 0; si < files.length; si += STAT_BATCH) {
          const batch = files.slice(si, si + STAT_BATCH);
          const batchStats = await Promise.all(batch.map(async f => {
            try {
              const s = await fs.stat(path.join(dir, f));
              return { name: f, mtime: s.mtimeMs };
            } catch { return { name: f, mtime: 0 }; }
          }));
          withMtime.push(...batchStats);
        }
        withMtime.sort((a, b) => b.mtime - a.mtime);
        files = withMtime.slice(0, limit).map(x => x.name);
      }

      const results: CapturedSession[] = [];
      const lazy = this.isLazyEnabled();

      const CHUNK_SIZE = 20;
      for (let i = 0; i < files.length; i += CHUNK_SIZE) {
        const chunk = files.slice(i, i + CHUNK_SIZE);
        await Promise.all(chunk.map(async (f) => {
          const filePath = path.join(dir, f);
          const ext = path.extname(f).toLowerCase();
          try {
            const s = await fs.stat(filePath);
            if (s.size < 500) return;

            if (lazy) {
              // Pre-scan: regex extraction, no full JSON.parse
              const prescanResult = ext === '.jsonl'
                ? await this.prescanJsonl(filePath)
                : await this.prescanJson(filePath);

              for (const p of prescanResult) {
                if (!p.sessionId && !p.firstMsg) continue;
                results.push({
                  sourceIde: this.ideId,
                  capturedAt: new Date(s.mtimeMs).toISOString(),
                  sessionId: p.sessionId || path.basename(f, ext),
                  title: p.title,
                  workspacePath: wsPath,
                  messages: p.firstMsg ? [p.firstMsg] : [],
                  messagesLoaded: false,
                  fileSizeBytes: s.size,
                  metadata: { fileSessionId: p.sessionId },
                  rawPath: filePath,
                  readStatus: 'success',
                });
              }
            } else {
              // Eager: existing full-parse behavior
              const raw = await fs.readFile(filePath, 'utf8');
              const sessions: CopilotSession[] = [];

              if (ext === '.jsonl') {
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
                try { sessions.push(JSON.parse(raw) as CopilotSession); } catch { /* skip */ }
              }

              for (const session of sessions) {
                if (session?.requests?.length) {
                  const messages = this.parseMessages(session.requests);
                  if (messages.length > 0) {
                    results.push({
                      sourceIde: this.ideId,
                      capturedAt: new Date(s.mtimeMs).toISOString(),
                      sessionId: session.sessionId || path.basename(f, ext),
                      title: session.customTitle,
                      workspacePath: wsPath,
                      messages,
                      messagesLoaded: true,
                      fileSizeBytes: s.size,
                      rawPath: filePath,
                      readStatus: 'success',
                    });
                  }
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

  /**
   * Pre-scan a JSONL file: readline line-by-line + regex extraction.
   * Avoids JSON.parse entirely — safe even for 127MB files.
   * Collects one entry per unique sessionId found.
   */
  private async prescanJsonl(filePath: string): Promise<Array<{ sessionId?: string; title?: string; firstMsg?: ChatMessage }>> {
    const found = new Map<string, { sessionId?: string; title?: string; firstMsg?: ChatMessage }>();
    // 新版格式：從 kind=0 行抓 sessionId/title，從 kind=2 k="requests" 抓第一條 user 訊息
    let newFormatSessionId: string | undefined;
    let newFormatTitle: string | undefined;
    let newFormatFirstMsg: ChatMessage | undefined;
    let isNewFormat = false;

    const stream = fsSync.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 65536 });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.includes('"requests"')) continue;

      // 嘗試解析以區分新舊格式
      try {
        const parsed = JSON.parse(line) as CopilotJsonlLine;

        // kind=0 行：區分新舊格式
        if (parsed.kind === 0) {
          const v = parsed.v as CopilotSession;
          if (v?.sessionId) {
            if (Array.isArray(v.requests) && v.requests.length === 0) {
              // 新版格式：requests 是空的，實際資料在後面的 kind=2 行
              newFormatSessionId = v.sessionId;
              newFormatTitle = v.customTitle;
              isNewFormat = true;
            } else if (Array.isArray(v.requests) && v.requests.length > 0) {
              // 舊版格式：資料直接在 snapshot 裡，立即加入 found
              const firstReq = v.requests[0];
              const firstText = firstReq?.message?.text?.trim();
              if (!found.has(v.sessionId)) {
                found.set(v.sessionId, {
                  sessionId: v.sessionId,
                  title: v.customTitle,
                  firstMsg: firstText ? { role: 'user', content: firstText.slice(0, 300) } : undefined,
                });
              }
            }
            continue;
          }
        }

        // 新版格式：kind=2 且 k="requests" 或 k=["requests"]，取第一條 user 訊息
        const kIsTopLevelRequests = parsed.k === 'requests' ||
          (Array.isArray(parsed.k) && parsed.k.length === 1 && parsed.k[0] === 'requests');
        if (parsed.kind === 2 && kIsTopLevelRequests && Array.isArray(parsed.v)) {
          const reqs = parsed.v as CopilotRequest[];
          if (!newFormatFirstMsg && reqs.length > 0) {
            const firstText = reqs[0]?.message?.text?.trim();
            if (firstText) {
              newFormatFirstMsg = { role: 'user', content: firstText.slice(0, 300) };
            }
          }
          // 新版格式已取得所有需要的資訊，提早結束避免讀完整個大檔案
          if (isNewFormat && newFormatSessionId && newFormatFirstMsg) {
            rl.close();
            stream.destroy();
            break;
          }
          continue;
        }

        // 舊版格式：kind=0 行含完整 requests
        const v = parsed.v as CopilotSession;
        if (!v?.sessionId) continue;
        if (found.has(v.sessionId)) continue;
        const firstReq = v.requests?.[0];
        const firstText = firstReq?.message?.text?.trim();
        found.set(v.sessionId, {
          sessionId: v.sessionId,
          title: v.customTitle,
          firstMsg: firstText ? { role: 'user', content: firstText.slice(0, 300) } : undefined,
        });
      } catch {
        // Fallback：regex 掃描（舊版格式）
        const sessionIdMatch = line.match(/"sessionId"\s*:\s*"([^"]+)"/);
        if (!sessionIdMatch) continue;
        const sessionId = sessionIdMatch[1];
        if (found.has(sessionId)) continue;
        const titleMatch = line.match(/"customTitle"\s*:\s*"([^"]+)"/);
        const textMatch = line.match(/"text"\s*:\s*"([^"]{0,300})"/);
        found.set(sessionId, {
          sessionId,
          title: titleMatch?.[1],
          firstMsg: textMatch?.[1]?.trim() ? { role: 'user', content: textMatch[1].trim() } : undefined,
        });
      }
    }

    // 新版格式：只有有實際訊息時才加入（避免空 session 出現在清單）
    if (isNewFormat && newFormatSessionId && newFormatFirstMsg) {
      found.set(newFormatSessionId, {
        sessionId: newFormatSessionId,
        title: newFormatTitle,
        firstMsg: newFormatFirstMsg,
      });
    }

    return [...found.values()];
  }

  /**
   * Pre-scan a .json file: read first 64KB, regex extraction.
   * Old Copilot format is a single session per file.
   */
  private async prescanJson(filePath: string): Promise<Array<{ sessionId?: string; title?: string; firstMsg?: ChatMessage }>> {
    let fd: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      fd = await fs.open(filePath, 'r');
      const buffer = Buffer.alloc(65536);
      const { bytesRead } = await fd.read(buffer, 0, 65536, 0);
      const chunk = buffer.toString('utf8', 0, bytesRead);

      const sessionIdMatch = chunk.match(/"sessionId"\s*:\s*"([^"]+)"/);
      const titleMatch = chunk.match(/"customTitle"\s*:\s*"([^"]+)"/);
      const textMatch = chunk.match(/"text"\s*:\s*"([^"]{0,300})"/);

      return [{
        sessionId: sessionIdMatch?.[1],
        title: titleMatch?.[1],
        firstMsg: textMatch?.[1]?.trim()
          ? { role: 'user', content: textMatch[1].trim() }
          : undefined,
      }];
    } catch { }
    finally { await fd?.close(); }
    return [];
  }

  /**
   * Full load entry point. Size-tiered to prevent OOM.
   */
  async loadFullMessages(session: CapturedSession): Promise<void> {
    const ext = path.extname(session.rawPath).toLowerCase();

    if (ext === '.jsonl') {
      session.messages = await this.loadJsonlFull(session.rawPath, session.sessionId);
    } else {
      const fileStat = await this.safeStat(session.rawPath);
      if (!fileStat) return;
      const sizeMB = fileStat.size / (1024 * 1024);

      if (sizeMB < 10) {
        // Small .json: safe to JSON.parse
        const raw = await this.safeReadFile(session.rawPath);
        if (!raw) return;
        try {
          const copilotSession = JSON.parse(raw) as CopilotSession;
          if (copilotSession.requests) {
            session.messages = this.parseMessages(copilotSession.requests);
          }
        } catch { }
      } else {
        // Large .json (>10MB): regex extraction via streaming — no JSON.parse
        session.messages = await this.loadJsonWithRegex(session.rawPath);
      }
    }
  }

  async hydrateSessionSummary(session: CapturedSession): Promise<void> {
    if (session.messages.length > 0 || session.title) {
      return;
    }

    const ext = path.extname(session.rawPath).toLowerCase();
    const prescanResult = ext === '.jsonl'
      ? await this.prescanJsonl(session.rawPath)
      : await this.prescanJson(session.rawPath);

    const first = prescanResult.find(p => p.firstMsg || p.title || p.sessionId);
    if (!first) {
      session.readStatus = 'empty';
      return;
    }

    if (!first.firstMsg && !first.title) {
      session.readStatus = 'empty';
      return;
    }

    session.sessionId = first.sessionId;
    session.title = first.title;
    session.messages = first.firstMsg ? [first.firstMsg] : [];
    session.metadata = { ...session.metadata, fileSessionId: first.sessionId };
  }

  /**
   * Streams through a JSONL file with readline.
   * 支援兩種格式：
   *   - 舊版：kind=0 行含完整 v.requests[]，取最後一筆（最完整快照）
   *   - 新版：kind=0 的 requests 是空的，真正資料在 kind=2 且 k="requests" 的行
   */
  private async loadJsonlFull(filePath: string, targetSessionId: string | undefined): Promise<ChatMessage[]> {
    let bestSession: CopilotSession | undefined;
    // 新版格式：每個 k=["requests"] 行只含 1 筆新 request（追加模式，非取代整個陣列）
    // 必須把所有 block 串接才能還原完整對話
    const newFormatRequests: CopilotRequest[] = [];
    // k=["requests", N, "response"] 行是第 N 輪的 response patch，保留最後一次
    const responsePatches = new Map<number, CopilotMessagePart[]>();
    let isNewFormat = false;

    const stream = fsSync.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 65536 });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as CopilotJsonlLine;

        // 新版格式：kind=2 k=["requests"]，追加（不取代）到累積陣列
        const kIsTopLevelRequests = parsed.k === 'requests' ||
          (Array.isArray(parsed.k) && parsed.k.length === 1 && parsed.k[0] === 'requests');
        if (parsed.kind === 2 && kIsTopLevelRequests && Array.isArray(parsed.v)) {
          for (const r of parsed.v as CopilotRequest[]) {
            newFormatRequests.push({ ...r });
          }
          isNewFormat = true;
          continue;
        }

        // 新版格式：kind=2 k=["requests", N, "response"]，記錄 response patch
        if (parsed.kind === 2 &&
            Array.isArray(parsed.k) && parsed.k.length === 3 &&
            parsed.k[0] === 'requests' && parsed.k[2] === 'response' &&
            Array.isArray(parsed.v)) {
          const idx = parsed.k[1];
          if (typeof idx === 'number') {
            responsePatches.set(idx, parsed.v as CopilotMessagePart[]);
          }
          continue;
        }

        // 舊版格式：kind=0 行含完整 session snapshot
        const v = parsed.v as CopilotSession | undefined;
        if (!v?.requests?.length) continue;
        if (!targetSessionId || v.sessionId === targetSessionId) {
          bestSession = v;
        }
      } catch { continue; }
    }

    // 新版格式：把 response patch 合回對應的 request
    if (isNewFormat) {
      for (const [idx, resp] of responsePatches) {
        if (newFormatRequests[idx]) {
          newFormatRequests[idx] = { ...newFormatRequests[idx], response: resp };
        }
      }
    }

    const requests = isNewFormat ? newFormatRequests : bestSession?.requests;
    if (!requests?.length) return [];
    return this.parseMessages(requests);
  }

  /**
   * Regex-based extraction for large .json files (>10MB).
   * Streams line-by-line and uses regex to extract user/assistant text without JSON.parse.
   */
  private async loadJsonWithRegex(filePath: string): Promise<ChatMessage[]> {
    const MAX_TEXT = 5000;
    const messages: ChatMessage[] = [];

    const stream = fsSync.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 65536 });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      // User messages: "text":"..."
      const userMatches = line.matchAll(/"text"\s*:\s*"([^"]{1,5000})"/g);
      for (const m of userMatches) {
        const text = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
        if (text.length > 5) {
          messages.push({ role: 'user', content: text.slice(0, MAX_TEXT) });
        }
      }

      // Assistant messages: "value":"..."
      const assistantMatches = line.matchAll(/"value"\s*:\s*"([^"]{1,5000})"/g);
      for (const m of assistantMatches) {
        const text = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
        if (text.length > 5) {
          messages.push({ role: 'assistant', content: text.slice(0, MAX_TEXT) });
        }
      }

      if (messages.length > 200) break;
    }

    return messages;
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
