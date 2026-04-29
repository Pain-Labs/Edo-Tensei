# Edo Tensei – Development Guide

---

## Environment Setup

**Requirements**

- Node.js v16 or above
- VS Code v1.79.0 or above
- TypeScript (included in devDependencies)

**Install dependencies**

```bash
git clone https://github.com/Pain-Labs/Edo-Tensei.git
cd Edo-Tensei
npm install
```

---

## Build

```bash
# One-time build
npm run build

# Watch mode (rebuild on save)
npm run watch
```

The build uses **esbuild** to bundle `src/extension.ts` into a single `dist/extension.js`. There is no `tsc --watch` step needed.

---

## Debug (Extension Development Host)

1. Open the project folder in VS Code.
2. Press `F5` — this runs the `Run Extension` launch configuration in `.vscode/launch.json`.
3. A new **Extension Development Host** window opens with Edo Tensei loaded.
4. After changing source files, run `npm run build` and press `Ctrl+R` / `Cmd+R` in the host window to reload.

---

## Project Structure

```
edo-tensei/
├── .vscode/
│   ├── launch.json          # F5 debug config
│   └── tasks.json           # Build task
├── dist/
│   └── extension.js         # Bundled output (committed for VSIX)
├── docs/
│   ├── assets/
│   │   └── edo_tensei_icon_128.png
│   ├── README.ja.md         # Japanese translation
│   ├── README.ko.md         # Korean translation
│   ├── README.zh-CN.md      # Simplified Chinese translation
│   ├── README.zh-TW.md      # Traditional Chinese translation
│   └── session-handoff/     # Internal product docs (not packaged)
├── src/
│   ├── extension.ts         # Extension entry — activate(), deactivate()
│   ├── core/
│   │   ├── SessionHandoffService.ts   # Orchestrates extractors, builds prompts
│   │   └── extractors/
│   │       ├── types.ts               # CapturedSession, ChatMessage, IChatExtractor
│   │       ├── AntigravityExtractor.ts
│   │       ├── ClaudeExtractor.ts
│   │       ├── CodexExtractor.ts
│   │       ├── CopilotExtractor.ts
│   │       ├── CursorExtractor.ts
│   │       ├── KiroExtractor.ts
│   │       ├── TraeExtractor.ts       # Disabled (SQLCipher encryption)
│   │       └── WindsurfExtractor.ts
│   └── ui/
│       └── SessionHandoffProvider.ts  # TreeDataProvider for the sidebar view
├── package.json
├── tsconfig.json
├── .vscodeignore
├── README.md
├── CHANGELOG.md
├── DEVELOPMENT.md
└── LICENSE
```

### Module Responsibilities

| File | Role |
| :--- | :--- |
| `extension.ts` | Command registration, file system watcher, `.gitignore` helper |
| `SessionHandoffService.ts` | Runs all extractors in parallel, caches results, builds handoff prompts |
| `SessionHandoffProvider.ts` | `TreeDataProvider` — groups sessions by IDE in the Activity Bar panel |
| `extractors/types.ts` | `IChatExtractor` interface + `CapturedSession` / `ChatMessage` types |
| Each `*Extractor.ts` | Reads one IDE's local storage and returns `CapturedSession[]` |

---

## Adding a New IDE Extractor

1. Create `src/core/extractors/MyIdeExtractor.ts` implementing `IChatExtractor`:

```typescript
export class MyIdeExtractor implements IChatExtractor {
    readonly ideId = 'myide' as const;

    async extract(workspacePath?: string, customScanPaths: string[] = []): Promise<CapturedSession> { … }
    async extractAll(workspacePath?: string, customScanPaths: string[] = []): Promise<CapturedSession[]> { … }
}
```

1. Register it in `SessionHandoffService.ts`:

```typescript
this.extractors = [
    …,
    new MyIdeExtractor(),
];
```

1. Add a reading guide to `IDE_READ_GUIDES` in `SessionHandoffService.ts` (used when `handoffMode` is `path`):

```typescript
myide: [
    'Format: …',
    '- Tip: …',
].join('\n'),
```

1. Add the new IDE key to `edoTensei.customScanPaths` in `package.json` `configuration.properties`.

---

## Handoff Prompt Logic

`SessionHandoffService.buildPromptFromCapturedSession()` selects between two modes:

- **`path` mode**: calls `buildPathHandoffPrompt()` — outputs the raw session file path plus a per-IDE reading guide. Falls back to `fullText` if the IDE has no registered guide (e.g., Windsurf binary format).
- **`fullText` mode**: calls `buildFullTextPrompt()` — embeds all parsed messages.

Both modes respect `edoTensei.promptLanguage` (English / Traditional Chinese).

---

## Publishing

```bash
# Install vsce if not already installed
npm install -g @vscode/vsce

# Build and package
npm run build
vsce package

# Publish to VS Code Marketplace
vsce publish
```

Version bumping:

```bash
npm version patch   # 1.0.0 → 1.0.1
npm version minor   # 1.0.0 → 1.1.0
npm version major   # 1.0.0 → 2.0.0
```

Update `CHANGELOG.md` before each release.

---

## Common Issues

**`Cannot find module 'vscode'`**

```bash
npm install --save-dev @types/vscode@^1.79.0
```

**Changes not reflected after editing source**

Run `npm run build` and reload the Extension Development Host window (`Ctrl+R`).

**Session not found for my project**

Check that the IDE's storage path exists on your machine. Use `edoTensei.customScanPaths` to point to a non-default location. Enable the VS Code Output panel → "Edo Tensei" channel for extractor error logs.
