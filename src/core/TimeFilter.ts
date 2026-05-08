export interface TimeRange {
  from?: Date;
  to?: Date;
  label: string;
}

export class TimeFilter {
  static parse(input?: string, now = new Date()): TimeRange | undefined {
    const text = input?.trim();
    if (!text) return undefined;

    const lower = text.toLowerCase();
    if (lower === 'today' || text === '今天') {
      return { from: this.startOfDay(now), to: now, label: text };
    }
    if (lower === 'yesterday' || text === '昨天') {
      const day = this.addDays(this.startOfDay(now), -1);
      return { from: day, to: this.endOfDay(day), label: text };
    }
    if (lower === 'this week' || text === '本週' || text === '这周') {
      return { from: this.startOfWeek(now), to: now, label: text };
    }

    const recent = text.match(/^(?:recent|last|最近)\s*(\d+)\s*(day|days|天|日)$/i);
    if (recent) {
      const days = Number(recent[1]);
      return { from: this.addDays(now, -days), to: now, label: text };
    }

    const range = text.match(/^(\d{4}[-/]\d{1,2}[-/]\d{1,2})\s*(?:to|~|-|到|至)\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})$/i);
    if (range) {
      const from = this.parseDate(range[1]);
      const to = this.parseDate(range[2]);
      if (from && to) {
        return { from: this.startOfDay(from), to: this.endOfDay(to), label: text };
      }
    }

    const date = this.parseDate(text);
    if (date) {
      return { from: this.startOfDay(date), to: this.endOfDay(date), label: text };
    }

    return undefined;
  }

  static contains(range: TimeRange | undefined, isoDate: string): boolean {
    if (!range) return true;
    const time = new Date(isoDate).getTime();
    if (Number.isNaN(time)) return false;
    if (range.from && time < range.from.getTime()) return false;
    if (range.to && time > range.to.getTime()) return false;
    return true;
  }

  private static parseDate(input: string): Date | undefined {
    const normalized = input.replace(/\//g, '-');
    const d = new Date(`${normalized}T00:00:00`);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }

  private static startOfDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  }

  private static endOfDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  }

  private static startOfWeek(d: Date): Date {
    const start = this.startOfDay(d);
    start.setDate(start.getDate() - start.getDay());
    return start;
  }

  private static addDays(d: Date, days: number): Date {
    const copy = new Date(d);
    copy.setDate(copy.getDate() + days);
    return copy;
  }
}
