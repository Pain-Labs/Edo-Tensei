import * as fs from 'fs';
import * as path from 'path';
import { ChatMessage } from './extractors/types';

export interface PathInferenceResult {
  workspacePath?: string;
  confidence: number;
  evidence: string[];
  reason: string;
}

export interface PathInferenceOptions {
  candidateWorkspacePath?: string;
  maxEvidence?: number;
}

const ABSOLUTE_PATH_RE = /(?:[A-Za-z]:[\\/][^\s"'`<>{}|]+|\/(?:Users|home|workspace|workspaces|mnt|var|tmp|opt)\/[^\s"'`<>{}|]+)/g;
const RELATIVE_PATH_RE = /(?:^|[\s"'`(])((?:\.{1,2}[\\/])?(?:(?:src|app|lib|docs|test|tests|packages|components|pages|public|assets|scripts|server|client|mcp-server|\.github|\.vscode)[\\/][^\s"'`<>{}|]+|[A-Za-z0-9_.-]+(?:\.[A-Za-z0-9]+)?[\\/](?:src|app|lib|docs|test|tests|packages|components|pages|public|assets|scripts)[\\/][^\s"'`<>{}|]+))/g;

export class PathInference {
  static inferWorkspacePath(messages: ChatMessage[], options: PathInferenceOptions = {}): PathInferenceResult {
    const maxEvidence = options.maxEvidence ?? 12;
    const text = messages.map(m => m.content).join('\n');
    const paths = this.extractPathMentions(text);

    if (options.candidateWorkspacePath) {
      const candidate = path.resolve(options.candidateWorkspacePath);
      const candidateResult = this.scoreCandidate(candidate, paths, maxEvidence);
      if (candidateResult.confidence >= 0.5) {
        return candidateResult;
      }
    }

    const absolute = paths
      .filter(p => path.isAbsolute(p))
      .map(p => this.normalizeMention(p))
      .filter((p): p is string => Boolean(p));

    const common = this.findCommonDirectory(absolute);
    if (common) {
      return {
        workspacePath: common,
        confidence: absolute.length >= 3 ? 0.9 : 0.72,
        evidence: absolute.slice(0, maxEvidence),
        reason: 'common-parent-from-absolute-paths',
      };
    }

    return {
      confidence: 0,
      evidence: paths.slice(0, maxEvidence),
      reason: paths.length > 0 ? 'path-mentions-found-but-no-workspace' : 'no-path-mentions',
    };
  }

  static inferFromText(raw: string, options: PathInferenceOptions = {}): PathInferenceResult {
    return this.inferWorkspacePath([{ role: 'user', content: raw }], options);
  }

  static extractPathMentions(text: string): string[] {
    const found = new Set<string>();

    for (const m of text.matchAll(ABSOLUTE_PATH_RE)) {
      const cleaned = this.cleanPathMention(m[0]);
      if (cleaned) found.add(cleaned);
    }

    for (const m of text.matchAll(RELATIVE_PATH_RE)) {
      const cleaned = this.cleanPathMention(m[1]);
      if (cleaned) found.add(cleaned);
    }

    return [...found];
  }

  private static scoreCandidate(candidate: string, mentions: string[], maxEvidence: number): PathInferenceResult {
    const evidence: string[] = [];
    let hits = 0;

    for (const mention of mentions) {
      const normalizedMention = this.normalizeMention(mention);
      if (!normalizedMention) continue;

      if (path.isAbsolute(normalizedMention)) {
        if (this.isInside(candidate, normalizedMention)) {
          hits++;
          evidence.push(mention);
        }
      } else if (this.existsUnder(candidate, normalizedMention)) {
        hits++;
        evidence.push(mention);
      }
    }

    const confidence = hits >= 5 ? 0.95 : hits >= 3 ? 0.85 : hits >= 2 ? 0.65 : hits === 1 ? 0.5 : 0;
    return {
      workspacePath: confidence > 0 ? candidate : undefined,
      confidence,
      evidence: evidence.slice(0, maxEvidence),
      reason: confidence > 0 ? 'candidate-workspace-path-evidence' : 'candidate-workspace-path-no-evidence',
    };
  }

  private static findCommonDirectory(paths: string[]): string | undefined {
    const dirs = paths
      .map(p => {
        try {
          const stat = fs.existsSync(p) ? fs.statSync(p) : undefined;
          return stat?.isDirectory() ? p : path.dirname(p);
        } catch {
          return path.dirname(p);
        }
      })
      .filter(Boolean);

    if (dirs.length === 0) return undefined;

    const split = dirs.map(d => path.resolve(d).split(/[\\/]+/).filter(Boolean));
    const common: string[] = [];
    for (let i = 0; i < split[0].length; i++) {
      const part = split[0][i].toLowerCase();
      if (split.every(s => s[i]?.toLowerCase() === part)) {
        common.push(split[0][i]);
      } else {
        break;
      }
    }

    if (common.length === 0) return undefined;
    const root = path.parse(dirs[0]).root;
    const dropDriveSegment = /^[A-Za-z]:$/.test(common[0]) ? 1 : 0;
    const resolved = path.resolve(root, ...common.slice(dropDriveSegment));
    return this.trimToProjectLikeRoot(resolved);
  }

  private static trimToProjectLikeRoot(dir: string): string {
    let current = dir;
    for (let i = 0; i < 6; i++) {
      if (['package.json', '.git', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'README.md'].some(name => fs.existsSync(path.join(current, name)))) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return dir;
  }

  private static existsUnder(root: string, relativePath: string): boolean {
    const cleanRelative = relativePath.replace(/^[.\\/]+/, '');
    try {
      return fs.existsSync(path.join(root, cleanRelative));
    } catch {
      return false;
    }
  }

  private static isInside(root: string, target: string): boolean {
    const rel = path.relative(path.resolve(root), path.resolve(target));
    return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
  }

  private static normalizeMention(mention: string): string | undefined {
    const cleaned = this.cleanPathMention(mention);
    if (!cleaned) return undefined;
    return path.normalize(cleaned);
  }

  private static cleanPathMention(value: string): string | undefined {
    const cleaned = value
      .trim()
      .replace(/[),.;:!?]+$/g, '')
      .replace(/^['"`]+|['"`]+$/g, '');
    if (!cleaned || cleaned.length < 3) return undefined;
    if (/\.(png|jpg|jpeg|gif|webp)$/i.test(cleaned)) return undefined;
    return cleaned;
  }
}
