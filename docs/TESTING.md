# Testing Guide (Edo Tensei)

[繁體中文](./TESTING.zh-TW.md) | English

This is the current, maintained reference for this repo's **automated** test
suites. This is the first version of this document — there was previously no
testing documentation of any kind in this repo.

If you add, rename, or remove a test file, update this doc in the same PR.

## Running the tests

| Suite | Command | What it covers |
| --- | --- | --- |
| Unit tests (Vitest) | `npm test` | Runs `vitest run` against every `src/test/**/*.test.ts` file (config default `include`), excluding `*.ui.test.ts`. Mocks `vscode` via a Vitest `resolve.alias` pointing at `src/test/__mocks__/vscode.ts` (see `vitest.config.ts`) |
| Unit tests (explicit subset) | `npm run test:unit` | Same Vitest run, but scoped explicitly to `src/test/core src/test/copilot src/test/security src/test/ui src/test/config` — today this covers the same files as `npm test` since those are the only unit-test directories that exist, but it's the one to extend if a new top-level `src/test/<area>` directory is added and shouldn't be swept in implicitly |
| Coverage | `npm run test:coverage` | `vitest run --coverage` (v8 provider). Coverage thresholds (90% statements/functions/lines, 80% branches) are enforced only for 4 specific files: `CodexExtractor.ts`, `PathInference.ts`, `SessionSearchEngine.ts`, `TimeFilter.ts` — not repo-wide |
| Watch mode | `npm run test:watch` | `vitest` in watch mode, for local development |
| UI / E2E tests | `npm run test:ui` | Real VS Code (pinned to `1.96.0`) + Selenium (`vscode-extension-tester`) driving the packaged extension end to end. Compiles `src/test/ui/**/*.ts` via `tsconfig.test.ui.json`, then runs `extest setup-and-run "out/test/ui/**/*.ui.test.js"` |
| UI test env setup only | `npm run test:ui:setup` | `extest setup-tests -c 1.96.0` — downloads/prepares the VS Code + ChromeDriver pair without running any tests |
| UI demo/recording run | `npm run test:ui:demo` | Writes demo settings (`write-demo-settings.cjs`), compiles the same `tsconfig.test.ui.json` sources, then runs only `*.visual.js` files (currently `sidebar-demo.visual.ts`) and writes a JSON report to `test-results/demo-code-settings.generated.json`. This is a recorded walkthrough for producing demo footage, not a correctness test — see the file's own description below |

**UI tests require a real, visible VS Code window and take several minutes.**
They should be run by a human on their own machine, not by an AI agent in a
sandboxed environment — driving a real Electron app via synthetic Selenium
input has known timing sensitivities (see "Known limitations" below).

There is no separate `mcp-server` test suite in this repo. `mcp-server/`
exists as a package (`mcp-server/package.json`, `mcp-server/src/`) but
currently has zero test files — its `package.json` only defines `build`,
`watch`, `start`, `dev`, `clean` scripts, no `test` script.

## File count and layout

This repo's test layout differs from other Pain-Labs/QuickPrompt-family
projects: it uses **Vitest**, not Jest, and there is no `mcp-server/src/test/`
directory at all (unlike PromptManager's `mcp-server` package, which does have
its own Jest suite). All 18 test-related files live under `src/test/`:

- **16 files** are plain `*.test.ts` unit tests run by Vitest (`src/test/config/`, `src/test/copilot/`, `src/test/core/`, `src/test/security/`, and one in `src/test/ui/`).
- **1 file** is the real `*.ui.test.ts` E2E suite (`src/test/ui/sidebar.ui.test.ts`), run only via `extest`/`test:ui`, never by Vitest (excluded by `vitest.config.ts`'s `exclude: ['src/test/**/*.ui.test.ts']`).
- **1 file**, `src/test/ui/SessionHandoffProvider.test.ts`, is a plain Vitest unit test even though it lives in the `ui/` directory alongside the E2E test — its `.test.ts` (not `.ui.test.ts`) suffix is what routes it to Vitest instead of `extest`. Don't assume everything under `src/test/ui/` is an E2E test; the suffix is what matters, not the folder.

Two more files live in `src/test/ui/` but are neither unit nor E2E tests —
they're shared support code, not test files themselves, so they aren't
counted in the "18":

- `recording.ts` — a helper class (`UiRecording`) that captures periodic screenshots during a UI run and stitches them into an `.mp4`/gif via `ffmpeg`, used by the demo run.
- `write-demo-settings.cjs` — writes a demo-friendly VS Code settings file before `test:ui:demo` runs.
- `sidebar-demo.visual.ts` — technically a `.ts` file compiled and run by `test:ui:demo`, but it's a scripted demo/recording walkthrough (uses `UiRecording`, clicks through the sidebar for footage), not an assertion-driven test — it doesn't fit either the unit or E2E test category and isn't part of `npm test` or `npm run test:ui`.
- `src/test/ui/fixtures/claude-projects/.../demo-session.jsonl` — a static fixture file consumed by the demo run, not a test file.

## Unit tests (Vitest)

| File | Covers |
| --- | --- |
| `src/test/config/packageJson.test.ts` | Regression tests against the raw `package.json` `contributes.menus` shape: toolbar (`view/title`) has `scanAllIdes` as primary and no `exportAllSessions`, IDE-item inline buttons (`refreshIde`, `exportAllSessions`) and context-menu groups, session-item inline buttons (`copyHandoffPrompt`, `copyRawPath`, `exportSession`). Guards against menu/button regressions that wouldn't otherwise produce a TypeScript error |
| `src/test/copilot/CopilotExtractor.test.ts` | `prescanJsonl`/`prescanJson`/`loadJsonlFull`/`extractAll` for the Copilot extractor across its v1–v4 on-disk session formats, including a named regression test for a `k=["requests"]` array-vs-string bug, scan-all vs. scan-project (workspace-filtered) behavior, and metadata-only pagination (limit/offset) so scan-all doesn't fully parse every candidate file |
| `src/test/core/AntigravityExtractor.test.ts` | `AntigravityExtractor.parseOverview` (stripping `<USER_REQUEST>` wrapper, truncation-marker detection, model-message extraction, malformed-line handling) and `extractAll` (prefers `transcript.jsonl`, falls back to `overview.txt`, returns empty when neither log exists) |
| `src/test/core/antigravityPaths.test.ts` | `getAntigravityBrainDirs` / `getAntigravityBrainDirsSync`: detecting multiple `.gemini`-based Antigravity directories, and falling back to a default directory both on an error and when none exist (async and sync variants) |
| `src/test/core/ClaudeExtractor.test.ts` | `ClaudeExtractor.parseClaudeJsonlWithMeta` (user/assistant parsing, `cwd` extraction, skipping malformed/blank lines and `tool_result` items, thinking-content inclusion, angle-bracket stripping, string-content post-compact summaries), plus `slugToWorkspacePath` and `isSlugMatchWorkspace` (Windows/Unix slug round-tripping and matching) |
| `src/test/core/CodexExtractor.test.ts` | A single, narrow test: `extract()` returns an empty codex session with `readStatus: 'empty'` when no `~/.codex/sessions` directory exists. (The bulk of Codex-specific extraction/parsing behavior is actually covered in `security/AngleBracketSanitization.test.ts`, not here — see below) |
| `src/test/core/CoworkExtractor.test.ts` | `CoworkExtractor.recordToMessage` (plain/array content, skipping thinking-only blocks, multi-block joining, `_audit_timestamp`, `maxChars` truncation), system-injection filtering, and file-based helpers: `parseAuditJsonl` (including a 60-second message-dedup window), `prescanFirstUserMessage`, `readChildMeta`, and `getWindowsMsixScanPaths` (locating `local-agent-mode-sessions` under Claude's Windows MSIX package layout) |
| `src/test/core/CursorExtractor.test.ts` | `CursorExtractor.pathToSlug` (Windows/Unix path-to-slug conversion, drive-letter lowercasing, slash normalization) and JSONL parsing (user/assistant role filtering, multi-part content joining) |
| `src/test/core/KiroExtractor.test.ts` | `isHexHash`, `decodeBase64UrlPath`, `parseLegacyKiroChat` (role filtering, acknowledgement-only and system-header message filtering, `<OPEN-EDITOR-FILES>`/`<EnvironmentContext>` stripping), `parseWorkspaceSessionJson`, and `parseFirstUserMessageFromWsSession` — the full range of legacy and current Kiro on-disk session formats |
| `src/test/core/PathInference.catch.test.ts` | Two targeted branch-coverage tests forcing `statSync`/`existsSync` to throw inside `findCommonDirectory` and `existsUnder`, confirming the catch branches are handled rather than propagating |
| `src/test/core/PathInference.test.ts` | `PathInference`'s general path-mention extraction and workspace-candidate scoring: unique path extraction with punctuation/image cleanup, resolving workspace evidence from absolute/relative mentions, falling back to a common parent directory, zero-confidence handling when evidence can't resolve a workspace, and filesystem-failure resilience |
| `src/test/core/SessionHandoffService.test.ts` | `SessionHandoffService`: concurrency-limited extractor scanning (caps simultaneous scans to avoid IO saturation), load-more pagination only applied to extractors that support it (loads one page at a time without duplicating sessions), `buildReadableTranscript` (workspace-path line placement, IDE-name capitalization), and `getGroupedSessions` (returns only the requested IDE's sessions, empty array for an unscanned IDE) |
| `src/test/core/SessionSearchEngine.test.ts` | `SessionSearchEngine`: recency-sorted results with no text matcher, scoring across title/workspace/raw-path/message fields, regex support (including invalid-regex handling) plus IDE/workspace/time/includeMessages filters, message-snippet truncation and centering around the first hit, and capping message snippets after metadata snippets |
| `src/test/core/SkillGenerator.test.ts` | `SkillGenerator`: generates into the user-selected workspace (not just the first one) in a multi-root setup, and treats cancelling the workspace picker as a quiet no-op rather than an error |
| `src/test/core/TimeFilter.test.ts` | `TimeFilter`: parsing "today"/"yesterday"/"this week" labels, recent-day windows, single dates and explicit ranges, undefined for empty/unsupported input, and checking whether ISO timestamps fall inside a parsed range |
| `src/test/security/AngleBracketSanitization.test.ts` | The largest test file, one `describe('angle bracket sanitization', ...)` block covering angle-bracket/tag stripping across **multiple** extractors, not just one: Cursor's `<user_query>` wrapper, tree-title extraction not reconstructing tags, Claude's angle-bracket content stripping (with `maxItemChars` truncation interaction), and a large Codex-focused section — filtering injected scaffolding/permissions blocks, role/prefix decisions for injected messages, parsing Codex rollout records (skipping malformed/injected entries), mapping non-user/non-assistant records to system messages, extracting rollout files with workspace filtering and empty fallback, filesystem-failure handling, ignoring non-matching filenames and symlinked entries, and respecting a configured recursion depth limit |
| `src/test/ui/SessionHandoffProvider.test.ts` | A plain Vitest unit test (despite living in `src/test/ui/` — see "File count and layout" above) covering `SessionItem` tooltip construction (`MarkdownString`, bold title, project/path lines, exact vs. lazy/estimated message counts, home vs. comment-discussion icons, description formatting), `SessionHandoffProvider.resolveTreeItem` (tooltip updates after lazy message load), and `SessionHandoffProvider.getChildren` (per-IDE root items, scan-state descriptions, `LoadingItem`/scan-triggering on first expand, `SessionItem` results after scan, home-icon matching against the open workspace folder, and `LoadMoreItem` pagination) |

## UI / E2E tests (`src/test/ui/*.ui.test.ts`)

| File | Covers |
|---|---|
| `sidebar.ui.test.ts` | The only real E2E suite in this repo (`describe('Edo Tensei sidebar', ...)`), opening the workbench and asserting: the Edo Tensei activity-bar button exists, a sidebar section titled "Edo Tensei" opens, at least one IDE parent row is visible before any scan, and all six known IDEs (`Claude`, `Copilot`, `Cursor`, `Antigravity`, `Kiro`, `Codex`) appear as tree items |

This is a much smaller E2E surface than sibling projects — there is exactly
one `.ui.test.ts` file, and it doesn't open a project-specific temp workspace
the way PromptManager's UI suite does per test file; it just waits for the
default workbench and checks the sidebar/tree render correctly.

## `vscode` mocking convention

Unit tests mock `vscode` via `src/test/__mocks__/vscode.ts`, wired up through
Vitest's `resolve.alias` in `vitest.config.ts`:

```ts
resolve: {
  alias: {
    vscode: resolve(__dirname, 'src/test/__mocks__/vscode.ts'),
  },
},
```

This is the Vitest equivalent of PromptManager's Jest `moduleNameMapper`
approach, same idea (redirect any `import ... from 'vscode'` to a hand-written
stub) but a different mechanism because this repo's test runner is Vitest, not
Jest. The mock itself is intentionally minimal — it only stubs `workspace`
(`getConfiguration`, `workspaceFolders`), `window` (`showQuickPick`,
`showErrorMessage`), `TreeItemCollapsibleState`, `MarkdownString`, `TreeItem`,
and `ThemeIcon` — just enough surface for the unit tests that import it. Any
test needing more of the `vscode` API would need to extend this file.

## UI test VS Code/Chromium cache

`test:ui` pins a specific VS Code/Chromium version (`-c 1.96.0`) but does
**not** pass a project-local `-s`/`--storage` override to `extest`. This
matches PromptManager's and editorGrouper's convention: it shares the
`%TEMP%/test-resources` VS Code download cache with sibling
`vscode-extension-tester`-based projects on the same machine, rather than
downloading its own ~150MB+ copy. One difference worth noting: both `test:ui`
and `test:ui:demo` explicitly delete the `settings` subfolder under
`%TEMP%/test-resources` before each run (via an inline `node -e` cleanup
step) — this doesn't create a project-local cache, it just resets stale
VS Code user settings inside the shared cache before each invocation, so the
shared-cache convention still holds.

## Known limitations

- **No dedicated `mcp-server` test suite.** Unlike PromptManager, where the
  `mcp-server` package has its own Jest config and tests, this repo's
  `mcp-server/` package currently ships with zero tests and no `test` script.
- **UI tests are inherently slower/flakier than unit tests** for the same
  reasons documented in sibling projects — they drive a real Electron app via
  synthetic Selenium input. Only one `.ui.test.ts` file exists today, so this
  risk surface is small, but treat any UI failure as a signal to investigate
  rather than an automatic real regression.
- **No flaky-test markers, retries, or "known issue"/workaround comments
  were found anywhere in `src/test/`** — a repo-wide grep for
  `flaky|retry|retries|known issue|workaround|TODO|skip(|xdescribe|xit(`
  (case-insensitive) across every test file returned no matches. That's a
  meaningfully different starting point than PromptManager, which has
  documented, deliberate UI-test workarounds (e.g. its dirty-editor hang fix
  and the removed hover E2E test) — there is no equivalent history to record
  here yet.
- **`sidebar-demo.visual.ts` is not a correctness test.** It's a scripted,
  recorded walkthrough used to produce demo footage/screenshots
  (`test:ui:demo`), driven by the `UiRecording` helper in `recording.ts`. It
  should not be read as additional UI test coverage beyond what
  `sidebar.ui.test.ts` provides.
- **`CodexExtractor.test.ts` itself is nearly empty (one test).** The
  substantial Codex parsing/extraction coverage — rollout record parsing,
  injected-scaffolding filtering, workspace-filtered extraction, recursion
  depth limits — actually lives in `security/AngleBracketSanitization.test.ts`
  instead, because that file was built up incrementally around the
  angle-bracket-sanitization security concern and absorbed most of the
  Codex-specific test cases along the way. Anyone looking for "where are the
  Codex tests" should check both files.
