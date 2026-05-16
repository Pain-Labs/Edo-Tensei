export const workspace = {
  getConfiguration: (_section?: string) => ({
    get: <T>(_key: string, defaultValue: T): T => defaultValue,
  }),
  workspaceFolders: undefined as undefined,
}

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
} as const

export class TreeItem {
  contextValue?: string
  description?: string
  iconPath?: unknown
  tooltip?: string
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
