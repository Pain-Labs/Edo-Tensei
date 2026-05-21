#!/usr/bin/env node
/**
 * TypeScript extractor benchmark — runs ClaudeExtractor logic directly in Node.
 * Usage: node bench/bench_ts.mjs [--dir DIR] [--full]
 *
 * Imports the compiled JS from dist/ (run: npm run build:ext first).
 * Because ClaudeExtractor uses vscode module, we mock it via the module
 * resolution alias below before any imports.
 */

import { createRequire } from 'module';
import { writeFileSync } from 'fs';

// ── Inline vscode mock ────────────────────────────────────────────────────────
const vscodeMock = {
  workspace: {
    getConfiguration: () => ({
      get: (_key, def) => def,
    }),
    workspaceFolders: undefined,
  },
};

// Patch require('vscode') before loading anything else
const req = createRequire(import.meta.url);
const Module = req('module');
const origLoad = Module._load;
Module._load = function(request, ...rest) {
  if (request === 'vscode') return vscodeMock;
  return origLoad.call(this, request, ...rest);
};

// ── Args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DIR  = (() => { const i = args.indexOf('--dir'); return i !== -1 ? args[i+1] : '/tmp/edo-bench/claude/projects'; })();
const FULL = args.includes('--full');

// ── Inline ClaudeExtractor logic (mirrors production, no vscode dep) ──────────
// We inline the core scan logic so we don't need a compiled dist/.
import { promises as fsp } from 'fs';
import * as fsSync from 'fs';
import * as readline from 'readline';
import * as path from 'path';

function slugToWorkspacePath(slug) {
  const winMatch = slug.match(/^([a-z])--(.+)$/);
  if (winMatch) {
    const drive = winMatch[1].toUpperCase();
    const rest  = winMatch[2].replace(/-/g, path.sep);
    return `${drive}:${path.sep}${rest}`;
  }
  if (slug.startsWith('-')) return '/' + slug.slice(1).replace(/-/g, '/');
  return undefined;
}

function extractMessage(obj) {
  const type = (obj.type || '').toLowerCase();
  if (type !== 'user' && type !== 'assistant') return undefined;
  const content = obj.message?.content;
  if (!Array.isArray(content)) return undefined;
  const parts = [];
  for (const c of content) {
    if (c.type === 'tool_result') continue;
    if (c.type === 'thinking' && c.thinking?.trim()) parts.push(c.thinking.trim());
    else if (typeof c.text === 'string') {
      const s = c.text.replace(/[<>]/g, '').trim();
      if (s) parts.push(s);
    }
  }
  const text = parts.join('\n').trim();
  return text ? { role: type, content: text, timestamp: obj.timestamp } : undefined;
}

async function prescan(filePath) {
  const stream = fsSync.createReadStream(filePath, { encoding: 'utf8', end: 16383 });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let cwd, firstMsg;
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    let obj;
    try { obj = JSON.parse(t); } catch { continue; }
    if (!cwd && obj.cwd) cwd = obj.cwd;
    if (!firstMsg && (obj.type || '').toLowerCase() === 'user') firstMsg = extractMessage(obj);
    if (cwd && firstMsg) break;
  }
  return { cwd, firstMsg };
}

async function parseFull(filePath) {
  const stream = fsSync.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const messages = [];
  let cwd;
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    let obj;
    try { obj = JSON.parse(t); } catch { continue; }
    if (!cwd && obj.cwd) cwd = obj.cwd;
    const m = extractMessage(obj);
    if (m) messages.push(m);
  }
  return { messages, cwd };
}

async function scanProjectsDir(projectsDir, full) {
  let slugs;
  try { slugs = await fsp.readdir(projectsDir); } catch { return []; }
  const sessions = [];
  await Promise.all(slugs.map(async slug => {
    const projDir = path.join(projectsDir, slug);
    let stat;
    try { stat = await fsp.stat(projDir); } catch { return; }
    if (!stat.isDirectory()) return;
    let files;
    try { files = await fsp.readdir(projDir); } catch { return; }
    await Promise.all(files.filter(f => f.endsWith('.jsonl')).map(async name => {
      const fp = path.join(projDir, name);
      let meta;
      try { meta = await fsp.stat(fp); } catch { return; }
      if (meta.size < 200) return;
      const mtime = meta.mtimeMs;
      const capturedAt = new Date(mtime).toISOString();
      const sessionId = name.replace(/\.jsonl$/, '');
      if (full) {
        const { messages, cwd } = await parseFull(fp);
        if (!messages.length) return;
        sessions.push({ sourceIde: 'claude', capturedAt, sessionId, workspacePath: cwd || slugToWorkspacePath(slug), messages, messagesLoaded: true, fileSizeBytes: meta.size, rawPath: fp, readStatus: 'success' });
      } else {
        const { firstMsg, cwd } = await prescan(fp);
        sessions.push({ sourceIde: 'claude', capturedAt, sessionId, workspacePath: cwd || slugToWorkspacePath(slug), messages: firstMsg ? [firstMsg] : [], messagesLoaded: false, fileSizeBytes: meta.size, rawPath: fp, readStatus: 'success' });
      }
    }));
  }));
  return sessions;
}

// ── Run benchmark ─────────────────────────────────────────────────────────────
console.log(`TypeScript benchmark — dir: ${DIR}, full: ${FULL}`);

const t0 = performance.now();
const sessions = await scanProjectsDir(DIR, FULL);
const elapsed = performance.now() - t0;

console.log(`Sessions found: ${sessions.length}`);
console.log(`Elapsed: ${elapsed.toFixed(1)} ms`);
console.log(JSON.stringify({ impl: 'typescript', sessions: sessions.length, elapsedMs: Math.round(elapsed) }));
