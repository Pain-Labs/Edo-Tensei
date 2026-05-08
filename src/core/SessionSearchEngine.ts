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

export class SessionSearchEngine {
  search(sessions: CapturedSession[], query: SessionSearchQuery): SessionSearchMatch[] {
    const timeRange = TimeFilter.parse(query.time);
    const matcher = this.createMatcher(query);
    const limit = Math.max(1, query.limit ?? 30);
    const workspace = query.workspacePath ? this.normalizePath(query.workspacePath) : undefined;

    const results: SessionSearchMatch[] = [];
    for (const session of sessions) {
      if (!TimeFilter.contains(timeRange, session.capturedAt)) continue;
      if (query.ide && session.sourceIde !== query.ide) continue;
      if (workspace && !this.matchesWorkspace(session, workspace)) continue;

      const match = this.scoreSession(session, matcher, query.includeMessages !== false);
      if (match.score > 0 || (!matcher && !query.regex && !query.query)) {
        results.push(match);
      }
    }

    return results
      .sort((a, b) => b.score - a.score || new Date(b.session.capturedAt).getTime() - new Date(a.session.capturedAt).getTime())
      .slice(0, limit);
  }

  private createMatcher(query: SessionSearchQuery): ((text: string) => boolean) | undefined {
    if (query.regex) {
      try {
        const re = new RegExp(query.regex, 'i');
        return text => re.test(text);
      } catch {
        return () => false;
      }
    }

    const terms = query.query
      ?.trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    if (!terms?.length) return undefined;
    return text => {
      const lower = text.toLowerCase();
      return terms.every(term => lower.includes(term));
    };
  }

  private scoreSession(session: CapturedSession, matcher: ((text: string) => boolean) | undefined, includeMessages: boolean): SessionSearchMatch {
    if (!matcher) {
      return { session, score: 1, matchedFields: ['time'], snippets: [] };
    }

    let score = 0;
    const matchedFields: string[] = [];
    const snippets: string[] = [];

    const fields: Array<[string, string | undefined, number]> = [
      ['title', session.title, 8],
      ['workspacePath', session.workspacePath, 5],
      ['rawPath', session.rawPath, 3],
    ];

    for (const [field, value, weight] of fields) {
      if (value && matcher(value)) {
        score += weight;
        matchedFields.push(field);
        snippets.push(`${field}: ${value}`);
      }
    }

    if (includeMessages) {
      for (const message of session.messages) {
        if (message.content && matcher(message.content)) {
          score += message.role === 'user' ? 6 : 4;
          if (!matchedFields.includes('messages')) matchedFields.push('messages');
          if (snippets.length < 5) snippets.push(this.makeSnippet(message.content));
        }
      }
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
}
