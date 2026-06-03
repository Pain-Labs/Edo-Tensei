import * as path from 'path';
import { CapturedSession } from './extractors/types';
import { TimeFilter } from './TimeFilter';

export interface SessionSearchQuery {
  query?: string;
  regex?: string;
  time?: string;
  ide?: CapturedSession['sourceIde'];
  workspacePath?: string;
  includeMessages?: boolean;
  limit?: number;
}

export interface SessionSearchMatch {
  session: CapturedSession;
  score: number;
  matchedFields: string[];
  snippets: string[];
}

// Regex that never matches — used as a sentinel for invalid regex patterns.
const NEVER_MATCH = /(?!)/;

export class SessionSearchEngine {
  search(sessions: CapturedSession[], query: SessionSearchQuery): SessionSearchMatch[] {
    const timeRange = TimeFilter.parse(query.time);
    const limit = Math.max(1, query.limit ?? 30);
    const workspace = query.workspacePath ? this.normalizePath(query.workspacePath) : undefined;
    const { regex, terms } = this.parseQuery(query);
    const hasFilter = !!(regex || terms?.length);

    const results: SessionSearchMatch[] = [];
    for (const session of sessions) {
      if (!TimeFilter.contains(timeRange, session.capturedAt)) continue;
      if (query.ide && session.sourceIde !== query.ide) continue;
      if (workspace && !this.matchesWorkspace(session, workspace)) continue;

      const match = this.scoreSession(session, terms, regex, query.includeMessages !== false);
      if (match.score > 0 || !hasFilter) {
        results.push(match);
      }
    }

    return results
      .sort((a, b) => new Date(b.session.capturedAt).getTime() - new Date(a.session.capturedAt).getTime() || b.score - a.score)
      .slice(0, limit);
  }

  private parseQuery(query: SessionSearchQuery): { regex: RegExp | undefined; terms: string[] | undefined } {
    if (query.regex) {
      try {
        return { regex: new RegExp(query.regex, 'i'), terms: undefined };
      } catch {
        return { regex: NEVER_MATCH, terms: undefined };
      }
    }
    const terms = query.query?.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return { regex: undefined, terms: terms?.length ? terms : undefined };
  }

  private scoreSession(
    session: CapturedSession,
    terms: string[] | undefined,
    regex: RegExp | undefined,
    includeMessages: boolean
  ): SessionSearchMatch {
    if (!terms && !regex) {
      return { session, score: 1, matchedFields: ['time'], snippets: [] };
    }

    let score = 0;
    const matchedFields: string[] = [];
    const snippets: string[] = [];
    // Track which terms are covered across all fields (for cross-field AND).
    const coveredTerms = terms ? new Set<string>() : undefined;

    const testField = (field: string, value: string | undefined, weight: number) => {
      if (!value) return;
      if (regex) {
        if (regex.test(value)) {
          score += weight;
          matchedFields.push(field);
          snippets.push(`${field}: ${value}`);
        }
      } else if (terms) {
        const lower = value.toLowerCase();
        const hits = terms.filter(t => lower.includes(t));
        if (hits.length > 0) {
          // Partial weight: proportional to how many terms this field covers.
          score += weight * hits.length / terms.length;
          matchedFields.push(field);
          snippets.push(`${field}: ${value}`);
          hits.forEach(t => coveredTerms!.add(t));
        }
      }
    };

    testField('title', session.title, 8);
    testField('sourceIde', session.sourceIde, 5);
    testField('workspacePath', session.workspacePath, 5);
    testField('rawPath', session.rawPath, 3);

    if (includeMessages) {
      for (const message of session.messages) {
        if (!message.content) continue;
        if (regex) {
          if (regex.test(message.content)) {
            score += message.role === 'user' ? 6 : 4;
            if (!matchedFields.includes('messages')) matchedFields.push('messages');
            if (snippets.length < 5) snippets.push(this.makeSnippet(message.content));
          }
        } else if (terms) {
          const lower = message.content.toLowerCase();
          const hits = terms.filter(t => lower.includes(t));
          if (hits.length > 0) {
            const w = message.role === 'user' ? 6 : 4;
            score += w * hits.length / terms.length;
            if (!matchedFields.includes('messages')) matchedFields.push('messages');
            if (snippets.length < 5) snippets.push(this.makeTargetedSnippet(message.content, lower, hits));
            hits.forEach(t => coveredTerms!.add(t));
          }
        }
      }
    }

    // Cross-field AND: require every term to be covered by at least one field.
    if (coveredTerms && coveredTerms.size < terms!.length) {
      return { session, score: 0, matchedFields: [], snippets: [] };
    }

    return { session, score, matchedFields, snippets };
  }

  private matchesWorkspace(session: CapturedSession, workspace: string): boolean {
    if (!session.workspacePath) return false;
    const sessionWs = this.normalizePath(session.workspacePath);
    return sessionWs === workspace || sessionWs.includes(workspace) || workspace.includes(sessionWs);
  }

  private normalizePath(value: string): string {
    return path.resolve(value).replace(/\\/g, '/').toLowerCase();
  }

  private makeSnippet(text: string): string {
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
  }

  // Extract a snippet centred around where the first hit term appears,
  // giving up to 300 chars of relevant context instead of always the beginning.
  private makeTargetedSnippet(text: string, lower: string, hits: string[]): string {
    const firstPos = Math.min(...hits.map(t => lower.indexOf(t)));
    const start = Math.max(0, firstPos - 50);
    const end = Math.min(text.length, start + 350);
    const raw = text.slice(start, end).replace(/\s+/g, ' ').trim();
    const prefix = start > 0 ? '…' : '';
    const suffix = end < text.length ? '…' : '';
    return prefix + raw + suffix;
  }
}
