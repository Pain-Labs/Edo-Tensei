/**
 * antigravityPaths.ts
 *
 * 共用的 Antigravity brain 目錄偵測邏輯。
 *
 * Antigravity 可能在 ~/.gemini 下有多個 data 目錄：
 *   - antigravity       （原始路徑）
 *   - antigravity-ide    （IDE 變體）
 *   - antigravity-*      （其他命名空間）
 *
 * 本模組提供 async 與 sync 兩個版本，供 Extractor（async I/O）
 * 與 SessionHandoffService（sync scan paths 清單）共用。
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

function getDefaultBrainDir(): string {
  return path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
}

function isAntigravityDir(name: string): boolean {
  return name === 'antigravity' || name.startsWith('antigravity-');
}

/**
 * 非同步偵測 ~/.gemini 下所有 antigravity* 目錄的 brain 路徑。
 * 失敗時回退至預設路徑。
 */
export async function getAntigravityBrainDirs(): Promise<string[]> {
  const geminiDir = path.join(os.homedir(), '.gemini');
  try {
    const entries = await fsPromises.readdir(geminiDir, { withFileTypes: true });
    const dirs: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory() && isAntigravityDir(entry.name)) {
        dirs.push(path.join(geminiDir, entry.name, 'brain'));
      }
    }
    return dirs.length > 0 ? dirs : [getDefaultBrainDir()];
  } catch {
    return [getDefaultBrainDir()];
  }
}

/**
 * 同步版本，供無法使用 async 的呼叫端使用（如 getExpectedScanPaths）。
 * 失敗時回退至預設路徑。
 */
export function getAntigravityBrainDirsSync(): string[] {
  const geminiDir = path.join(os.homedir(), '.gemini');
  try {
    const entries = fs.readdirSync(geminiDir, { withFileTypes: true });
    const dirs: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory() && isAntigravityDir(entry.name)) {
        dirs.push(path.join(geminiDir, entry.name, 'brain'));
      }
    }
    return dirs.length > 0 ? dirs : [getDefaultBrainDir()];
  } catch {
    return [getDefaultBrainDir()];
  }
}
