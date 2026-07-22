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

## CI/CD and Publishing

Publishing is handled by GitHub Actions, not by manual local publishing. The goal is to catch release problems during PR validation before a Marketplace publish has already happened.

### Release Flow

```text
feature branch
    |
    v
Pull Request to main
    |
    +--> Validate Extension workflow
    |       - version bump guard
    |       - typecheck
    |       - tests with coverage
    |       - VSIX packaging
    |       - Open VSX manifest compatibility check
    |
    v
merge to main with package.json version changed
    |
    v
Publish Extension workflow
    |
    +--> package once as edo-tensei.vsix
    +--> validate manifest compatibility
    +--> publish to VS Code Marketplace
    +--> publish the same VSIX to Open VSX
```

### Workflow Guardrails

| Stage | Workflow | Trigger | What it checks | Why it matters |
| :--- | :--- | :--- | :--- | :--- |
| PR validation | `.github/workflows/validate.yml` | Pull requests to `main` | Release-relevant changes must bump `package.json` version | Prevents merging code changes that will not trigger a publish or will reuse an existing version |
| PR validation | `.github/workflows/validate.yml` | Pull requests to `main`, branch pushes | `npm run typecheck` and `npm run test:coverage` | Catches TypeScript failures, unit test failures, and coverage regressions before merge |
| PR validation | `.github/workflows/validate.yml` | Pull requests to `main`, branch pushes | `npx @vscode/vsce package --out edo-tensei.vsix` | Verifies the extension can be packaged before release |
| PR validation | `.github/workflows/validate.yml` | Pull requests to `main`, branch pushes | VSIX `extension.vsixmanifest` display name must match `package.json` display name | Catches Open VSX manifest compatibility errors early |
| Publishing | `.github/workflows/publish.yml` | Push to `main` when `package.json` changes, or manual dispatch | Re-runs typecheck, tests, packaging, and manifest compatibility validation | Stops publishing before any registry call if the package is invalid |
| Publishing | `.github/workflows/publish.yml` | After validation passes | Publishes to VS Code Marketplace, then publishes the same `edo-tensei.vsix` to Open VSX | Keeps both registries using the same verified artifact |

### Test Coverage

`npm run test:coverage` runs the Vitest unit suite with V8 coverage enabled. PR validation uses this command instead of plain `npm test`.

Coverage thresholds are intentionally scoped to the core files with focused unit coverage:

- `src/core/extractors/CodexExtractor.ts`
- `src/core/PathInference.ts`
- `src/core/SessionSearchEngine.ts`
- `src/core/TimeFilter.ts`

Current thresholds:

| Metric | Minimum |
| :--- | ---: |
| Statements | 90% |
| Branches | 80% |
| Functions | 90% |
| Lines | 90% |

Do not expand coverage `include` patterns casually. Add tests for the newly included files in the same PR, otherwise unrelated legacy or UI-heavy code can make the coverage gate noisy without improving release confidence.

### Versioning Convention (Pre-release vs Stable)

Edo-Tensei follows the VS Code Marketplace pre-release convention based on the **minor version number**:

| Minor version | Parity | Published as |
|:---|:---|:---|
| 1.6.x, 1.8.x, 2.0.x, … | **Even** | Stable release (default channel) |
| 1.5.x, 1.7.x, 1.9.x, … | **Odd** | Pre-release (opt-in channel) |

**How CI handles this automatically:**

The `publish.yml` workflow reads the minor version from `package.json` at merge time:
- Odd minor → publishes with `vsce publish --pre-release`
- Even minor → publishes normally (stable)

You never need to pass `--pre-release` manually.

### Version Bumping

Every release-relevant PR must bump `package.json` and `package-lock.json`.

```bash
npm version patch --no-git-tag-version   # 1.0.0 -> 1.0.1
npm version minor --no-git-tag-version   # 1.0.0 -> 1.1.0
npm version major --no-git-tag-version   # 1.0.0 -> 2.0.0
```

The PR validation workflow treats these paths as release-relevant:

| Path pattern | Reason |
| :--- | :--- |
| `src/` | Extension runtime code |
| `mcp-server/src/` | Bundled MCP server runtime code |
| `i18n/` and `package.nls*.json` | User-facing localized text |
| `package.json` and `package-lock.json` | Manifest, dependencies, scripts, and version |
| `README.md`, `CHANGELOG.md`, `docs/README*`, `docs/assets/` | Marketplace/Open VSX package content |
| `.vscodeignore` | Controls what is included in the VSIX |
| `.github/workflows/` | CI/CD and publishing behavior |

Update `CHANGELOG.md` before each release.

### Local Preflight

Run these before opening a release PR:

```bash
npm run typecheck
npm run test:coverage
npx @vscode/vsce package --out edo-tensei.vsix
npx @vscode/vsce ls --tree
```

Do not publish manually from local development unless recovering from a CI outage. If local packaging creates a `.vsix`, it is ignored by Git.

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
