export const workspace = {
  getConfiguration: (_section?: string) => ({
    get: <T>(_key: string, defaultValue: T): T => defaultValue,
  }),
  workspaceFolders: undefined as Array<{ uri: { fsPath: string } }> | undefined,
}

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
} as const

export class MarkdownString {
  supportHtml = false
  constructor(public readonly value: string = '') {}
}

export class TreeItem {
  id?: string
  contextValue?: string
  description?: string
  iconPath?: unknown
  tooltip?: string | MarkdownString
  command?: unknown

  constructor(
    public readonly label: string,
    public readonly collapsibleState?: number,
  ) {}
}

export class ThemeIcon {
  constructor(public readonly id: string) {}
}

export class EventEmitter<T = unknown> {
  event = (_listener: (e: T) => unknown): { dispose: () => void } => ({ dispose: () => undefined })
  fire(_event?: T): void {}
  dispose(): void {}
}
