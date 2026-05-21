#!/usr/bin/env node
/**
 * Generates synthetic Claude session JSONL fixtures for benchmarking.
 * Usage: node bench/gen_fixtures.mjs [--projects N] [--sessions-per-project M] [--messages-per-session K] [--dir DIR]
 *
 * Defaults: 20 projects × 10 sessions × 40 messages = 8,000 sessions total
 */

import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

const args = process.argv.slice(2);
const get = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 ? parseInt(args[i + 1], 10) : def;
};

const NUM_PROJECTS   = get('--projects',               20);
const SESSIONS_PER   = get('--sessions-per-project',   10);
const MESSAGES_PER   = get('--messages-per-session',   40);
const OUT_DIR        = (() => { const i = args.indexOf('--dir'); return i !== -1 ? args[i+1] : '/tmp/edo-bench/claude/projects'; })();

const WORDS = ['refactor', 'authentication', 'database', 'query', 'optimize', 'render', 'pipeline',
               'module', 'interface', 'type', 'async', 'await', 'error', 'handle', 'parse', 'emit',
               'transform', 'validate', 'serialize', 'compress', 'encrypt', 'decode', 'filter', 'reduce'];

function randomWord() { return WORDS[Math.floor(Math.random() * WORDS.length)]; }
function randomSentence(n = 12) { return Array.from({ length: n }, randomWord).join(' ') + '.'; }
function randomParagraph(lines = 4) { return Array.from({ length: lines }, () => randomSentence()).join(' '); }
function randomHex(n = 32) { return randomBytes(n / 2).toString('hex'); }

function makeRecord(role, text, ts) {
  return JSON.stringify({
    type: role,
    timestamp: ts,
    cwd: `/home/user/project-${randomWord()}`,
    message: {
      role,
      content: [{ type: 'text', text }],
    },
  });
}

// Clean and recreate
rmSync(OUT_DIR, { recursive: true, force: true });

let totalFiles = 0;
for (let p = 0; p < NUM_PROJECTS; p++) {
  const slug = `-home-user-project-${randomWord()}-${p}`;
  const projDir = join(OUT_DIR, slug);
  mkdirSync(projDir, { recursive: true });

  for (let s = 0; s < SESSIONS_PER; s++) {
    const sessionId = randomHex(32);
    const lines = [];
    const base = Date.now() - Math.random() * 30 * 86400e3;

    for (let m = 0; m < MESSAGES_PER; m++) {
      const role = m % 2 === 0 ? 'user' : 'assistant';
      const ts = new Date(base + m * 60000).toISOString();
      lines.push(makeRecord(role, randomParagraph(m % 2 === 0 ? 3 : 5), ts));
    }

    writeFileSync(join(projDir, `${sessionId}.jsonl`), lines.join('\n') + '\n');
    totalFiles++;
  }
}

console.log(`Generated ${totalFiles} session files across ${NUM_PROJECTS} projects in ${OUT_DIR}`);
console.log(`Each file has ${MESSAGES_PER} messages (~${Math.round(MESSAGES_PER * 200 / 1024)} KB each)`);
