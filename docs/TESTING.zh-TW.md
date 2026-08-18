# 測試指南（Edo Tensei）

繁體中文 | [English](./TESTING.md)

這是本 repo **自動化**測試套件目前持續維護的參考文件。這是本文件的第一個版本 — 在此之前，本 repo 完全沒有任何測試文件。

如果你新增、重新命名或移除測試檔案，請在同一個 PR 中更新本文件。

## 執行測試

| 測試套件 | 指令 | 涵蓋範圍 |
| --- | --- | --- |
| 單元測試（Vitest） | `npm test` | 對每個 `src/test/**/*.test.ts` 檔案（設定檔預設的 `include`）執行 `vitest run`，排除 `*.ui.test.ts`。透過 Vitest 的 `resolve.alias` 指向 `src/test/__mocks__/vscode.ts` 來模擬 `vscode`（見 `vitest.config.ts`） |
| 單元測試（明確子集） | `npm run test:unit` | 與上面相同的 Vitest 執行，但明確限定範圍為 `src/test/core src/test/copilot src/test/security src/test/ui src/test/config` — 目前涵蓋的檔案與 `npm test` 相同，因為這些是唯一存在的單元測試目錄；但如果新增了一個頂層的 `src/test/<area>` 目錄、且不該被隱含掃入，就應該擴充這個指令的範圍 |
| 覆蓋率 | `npm run test:coverage` | `vitest run --coverage`（v8 provider）。覆蓋率門檻（90% 陳述式/函式/程式碼行，80% 分支）僅針對 4 個特定檔案強制執行：`CodexExtractor.ts`、`PathInference.ts`、`SessionSearchEngine.ts`、`TimeFilter.ts` — 並非整個 repo 都套用 |
| 監看模式 | `npm run test:watch` | 以監看模式執行 `vitest`，供本機開發使用 |
| UI / E2E 測試 | `npm run test:ui` | 使用真實的 VS Code（釘選在 `1.96.0`）＋ Selenium（`vscode-extension-tester`）端到端驅動已封裝的擴充功能。透過 `tsconfig.test.ui.json` 編譯 `src/test/ui/**/*.ts`，再執行 `extest setup-and-run "out/test/ui/**/*.ui.test.js"` |
| 僅設定 UI 測試環境 | `npm run test:ui:setup` | `extest setup-tests -c 1.96.0` — 下載／準備 VS Code + ChromeDriver 配對，但不執行任何測試 |
| UI 展示／錄製執行 | `npm run test:ui:demo` | 寫入展示用設定（`write-demo-settings.cjs`），編譯與上面相同的 `tsconfig.test.ui.json` 原始檔，接著只執行 `*.visual.js` 檔案（目前是 `sidebar-demo.visual.ts`），並將 JSON 報告寫入 `test-results/demo-code-settings.generated.json`。這是用來產生展示畫面的錄製走查，不是正確性測試 — 詳見下方該檔案自身的說明 |

**UI 測試需要一個真實、可見的 VS Code 視窗，且會花費數分鐘。**
這些測試應該由人類在自己的機器上執行，而不是由沙盒環境中的 AI agent 執行 — 透過合成的 Selenium
輸入驅動真實的 Electron 應用程式，已知存在時序敏感性問題（見下方「已知限制」）。

本 repo 沒有獨立的 `mcp-server` 測試套件。`mcp-server/` 是以套件形式存在
（`mcp-server/package.json`、`mcp-server/src/`），但目前沒有任何測試檔案 — 它的
`package.json` 只定義了 `build`、`watch`、`start`、`dev`、`clean` 腳本，沒有 `test` 腳本。

## 檔案數量與配置

本 repo 的測試配置與其他 Pain-Labs/QuickPrompt 家族專案不同：它使用的是 **Vitest**，不是 Jest，
而且完全沒有 `mcp-server/src/test/` 目錄（不像 PromptManager 的 `mcp-server` 套件那樣擁有自己的
Jest 套件）。所有 18 個與測試相關的檔案都位於 `src/test/` 底下：

- **16 個檔案**是由 Vitest 執行的一般 `*.test.ts` 單元測試（`src/test/config/`、`src/test/copilot/`、`src/test/core/`、`src/test/security/`，以及 `src/test/ui/` 中的一個）。
- **1 個檔案**是真正的 `*.ui.test.ts` E2E 套件（`src/test/ui/sidebar.ui.test.ts`），只透過 `extest`/`test:ui` 執行，Vitest 完全不會執行它（被 `vitest.config.ts` 的 `exclude: ['src/test/**/*.ui.test.ts']` 排除）。
- **1 個檔案**，`src/test/ui/SessionHandoffProvider.test.ts`，儘管它與 E2E 測試同樣位於 `ui/` 目錄底下，卻是一般的 Vitest 單元測試 — 決定它被 Vitest 而非 `extest` 執行的關鍵，是它的 `.test.ts`（而非 `.ui.test.ts`）副檔名。不要假設 `src/test/ui/` 底下的一切都是 E2E 測試；重點在於副檔名，不是資料夾。

另外還有兩個檔案位於 `src/test/ui/`，但既不是單元測試也不是 E2E 測試 — 它們是共用的輔助程式碼，
本身並非測試檔案，因此不計入前述的「18」個檔案：

- `recording.ts` — 一個輔助類別（`UiRecording`），在 UI 測試執行期間定期擷取螢幕截圖，並透過 `ffmpeg` 拼接成 `.mp4`/gif，供展示執行使用。
- `write-demo-settings.cjs` — 在 `test:ui:demo` 執行前寫入一份適合展示用的 VS Code 設定檔。
- `sidebar-demo.visual.ts` — 技術上是由 `test:ui:demo` 編譯並執行的 `.ts` 檔案，但它是一段腳本化的展示／錄製走查（使用 `UiRecording`，點擊瀏覽側邊欄以取得畫面），不是以斷言為基礎的測試 — 它不屬於單元測試或 E2E 測試的任一類別，也不屬於 `npm test` 或 `npm run test:ui` 的一部分。
- `src/test/ui/fixtures/claude-projects/.../demo-session.jsonl` — 一個由展示執行所使用的靜態固定資料檔案，不是測試檔案。

## 單元測試（Vitest）

| 檔案 | 涵蓋內容 |
| --- | --- |
| `src/test/config/packageJson.test.ts` | 針對原始 `package.json` 的 `contributes.menus` 結構所做的回歸測試：工具列（`view/title`）以 `scanAllIdes` 為主要按鈕、且沒有 `exportAllSessions`；IDE 項目的 inline 按鈕（`refreshIde`、`exportAllSessions`）與右鍵選單群組；session 項目的 inline 按鈕（`copyHandoffPrompt`、`copyRawPath`、`exportSession`）。用來防範那些原本不會產生 TypeScript 錯誤的選單／按鈕回歸問題 |
| `src/test/copilot/CopilotExtractor.test.ts` | Copilot extractor 在其 v1–v4 硬碟端 session 格式下的 `prescanJsonl`/`prescanJson`/`loadJsonlFull`/`extractAll`，包含一個針對 `k=["requests"]` 陣列 vs. 字串 bug 的具名回歸測試、scan-all 與 scan-project（以 workspace 過濾）的行為差異，以及僅限中繼資料的分頁（limit/offset），確保 scan-all 不會完整解析每一個候選檔案 |
| `src/test/core/AntigravityExtractor.test.ts` | `AntigravityExtractor.parseOverview`（移除 `<USER_REQUEST>` 包裝、偵測截斷標記、擷取模型訊息、處理格式錯誤的行）以及 `extractAll`（優先使用 `transcript.jsonl`，退回使用 `overview.txt`，兩者都不存在時回傳空結果） |
| `src/test/core/antigravityPaths.test.ts` | `getAntigravityBrainDirs` / `getAntigravityBrainDirsSync`：偵測多個以 `.gemini` 為基礎的 Antigravity 目錄，並在發生錯誤或找不到任何目錄時退回預設目錄（非同步與同步兩種版本） |
| `src/test/core/ClaudeExtractor.test.ts` | `ClaudeExtractor.parseClaudeJsonlWithMeta`（user/assistant 解析、擷取 `cwd`、略過格式錯誤／空白行與 `tool_result` 項目、納入 thinking 內容、移除角括號、compact 之後的字串內容摘要），以及 `slugToWorkspacePath` 與 `isSlugMatchWorkspace`（Windows/Unix slug 的雙向轉換與比對） |
| `src/test/core/CodexExtractor.test.ts` | 只有一個範圍很窄的測試：當 `~/.codex/sessions` 目錄不存在時，`extract()` 會回傳一個 `readStatus: 'empty'` 的空 codex session。（Codex 專屬的擷取／解析行為大多其實是在 `security/AngleBracketSanitization.test.ts` 中涵蓋，而不是在這裡 — 詳見下方） |
| `src/test/core/CoworkExtractor.test.ts` | `CoworkExtractor.recordToMessage`（純文字／陣列內容、略過純 thinking 區塊、多區塊合併、`_audit_timestamp`、`maxChars` 截斷）、系統注入內容過濾，以及以檔案為基礎的輔助函式：`parseAuditJsonl`（包含一個 60 秒的訊息去重視窗）、`prescanFirstUserMessage`、`readChildMeta`，以及 `getWindowsMsixScanPaths`（在 Claude 的 Windows MSIX 套件配置下定位 `local-agent-mode-sessions`） |
| `src/test/core/CursorExtractor.test.ts` | `CursorExtractor.pathToSlug`（Windows/Unix 路徑轉 slug、磁碟機代號轉小寫、斜線正規化）以及 JSONL 解析（user/assistant 角色過濾、多部分內容合併） |
| `src/test/core/KiroExtractor.test.ts` | `isHexHash`、`decodeBase64UrlPath`、`parseLegacyKiroChat`（角色過濾、過濾純確認訊息與系統標頭訊息、移除 `<OPEN-EDITOR-FILES>`/`<EnvironmentContext>`）、`parseWorkspaceSessionJson`，以及 `parseFirstUserMessageFromWsSession` — 涵蓋舊版與目前 Kiro 硬碟端 session 格式的完整範圍 |
| `src/test/core/PathInference.catch.test.ts` | 兩個針對性的分支覆蓋率測試，強制讓 `findCommonDirectory` 與 `existsUnder` 內部的 `statSync`/`existsSync` 拋出例外，確認 catch 分支會被妥善處理而不是往外傳播 |
| `src/test/core/PathInference.test.ts` | `PathInference` 一般性的路徑提及擷取與 workspace 候選項評分：帶有標點符號／圖片清理的唯一路徑擷取、從絕對／相對路徑提及解析出 workspace 證據、退回共同父目錄、當證據無法解析出 workspace 時的零信心度處理，以及對檔案系統失敗的容錯能力 |
| `src/test/core/SessionHandoffService.test.ts` | `SessionHandoffService`：限制並行數量的 extractor 掃描（限制同時掃描數量以避免 IO 飽和）、僅套用於支援該功能的 extractor 的載入更多分頁（一次載入一頁，不會重複 session）、`buildReadableTranscript`（workspace 路徑行的放置位置、IDE 名稱大寫化），以及 `getGroupedSessions`（只回傳所要求 IDE 的 session，尚未掃描的 IDE 回傳空陣列） |
| `src/test/core/SessionSearchEngine.test.ts` | `SessionSearchEngine`：沒有文字比對條件時依時間新舊排序結果、跨 title/workspace/raw-path/message 欄位計分、支援正規表示式（包含無效正規表示式的處理）加上 IDE/workspace/time/includeMessages 過濾條件、以第一個命中處為中心的訊息片段截斷，以及在中繼資料片段之後限制訊息片段的數量 |
| `src/test/core/SkillGenerator.test.ts` | `SkillGenerator`：在多根目錄（multi-root）設定下，會產生到使用者選取的 workspace（而不只是第一個），並將取消 workspace 選擇器視為安靜的無動作，而不是錯誤 |
| `src/test/core/TimeFilter.test.ts` | `TimeFilter`：解析「today」/「yesterday」/「this week」標籤、最近幾天的時間範圍、單一日期與明確的時間區間、空白／不支援輸入時回傳 undefined，以及檢查 ISO 時間戳記是否落在解析出的範圍內 |
| `src/test/security/AngleBracketSanitization.test.ts` | 篇幅最大的測試檔案，一個 `describe('angle bracket sanitization', ...)` 區塊涵蓋了**多個**（不只一個）extractor 的角括號／標籤移除：Cursor 的 `<user_query>` 包裝、樹狀標題擷取不會重組出標籤、Claude 的角括號內容移除（與 `maxItemChars` 截斷的交互作用），以及一大段以 Codex 為主的內容 — 過濾注入的 scaffolding／權限區塊、對注入訊息的角色／前綴判斷、解析 Codex rollout 紀錄（略過格式錯誤／注入的項目）、將非 user/非 assistant 的紀錄對應到系統訊息、以 workspace 過濾與空結果退回機制擷取 rollout 檔案、處理檔案系統失敗、忽略不符檔名與符號連結項目，以及遵守設定的遞迴深度限制 |
| `src/test/ui/SessionHandoffProvider.test.ts` | 一個一般的 Vitest 單元測試（儘管位於 `src/test/ui/` — 見上方「檔案數量與配置」），涵蓋 `SessionItem` 提示框（tooltip）的建構（`MarkdownString`、粗體標題、專案／路徑行、精確 vs. 延遲載入／估計的訊息數量、home 圖示 vs. 留言討論圖示、描述格式化）、`SessionHandoffProvider.resolveTreeItem`（延遲載入訊息後更新提示框），以及 `SessionHandoffProvider.getChildren`（每個 IDE 的根項目、掃描狀態描述、首次展開時的 `LoadingItem`／觸發掃描、掃描後的 `SessionItem` 結果、home 圖示與已開啟的 workspace 資料夾比對，以及 `LoadMoreItem` 分頁） |

## UI / E2E 測試（`src/test/ui/*.ui.test.ts`）

| 檔案 | 涵蓋內容 |
|---|---|
| `sidebar.ui.test.ts` | 本 repo 唯一真正的 E2E 套件（`describe('Edo Tensei sidebar', ...)`），開啟工作台並斷言：Edo Tensei 的 activity-bar 按鈕存在、名為「Edo Tensei」的側邊欄區塊會開啟、在任何掃描發生之前至少有一個 IDE 父列可見，以及所有六個已知的 IDE（`Claude`、`Copilot`、`Cursor`、`Antigravity`、`Kiro`、`Codex`）都以樹狀項目的形式出現 |

這比同系列的其他專案的 E2E 覆蓋範圍小得多 — 恰好只有一個 `.ui.test.ts` 檔案，而且它不會像
PromptManager 的 UI 套件那樣針對每個測試檔案開啟專案專屬的暫存 workspace；它只是等待預設的工作台，
並檢查側邊欄／樹狀結構是否正確渲染。

## `vscode` 模擬慣例

單元測試透過 `src/test/__mocks__/vscode.ts` 模擬 `vscode`，並透過 `vitest.config.ts` 中
Vitest 的 `resolve.alias` 接上：

```ts
resolve: {
  alias: {
    vscode: resolve(__dirname, 'src/test/__mocks__/vscode.ts'),
  },
},
```

這是 Vitest 版本、對應 PromptManager 的 Jest `moduleNameMapper` 做法 — 概念相同（將任何
`import ... from 'vscode'` 導向手寫的 stub），但機制不同，因為本 repo 的測試執行器是 Vitest，
不是 Jest。這個 mock 本身刻意做得很精簡 — 它只 stub 了 `workspace`（`getConfiguration`、
`workspaceFolders`）、`window`（`showQuickPick`、`showErrorMessage`）、`TreeItemCollapsibleState`、
`MarkdownString`、`TreeItem`，以及 `ThemeIcon` — 剛好夠讓引用它的單元測試使用。任何需要更多
`vscode` API 的測試，都需要擴充這個檔案。

## UI 測試的 VS Code/Chromium 快取

`test:ui` 釘選了特定的 VS Code/Chromium 版本（`-c 1.96.0`），但**不會**傳遞專案本機的
`-s`/`--storage` 覆寫給 `extest`。這符合 PromptManager 與 editorGrouper 的慣例：它與同一台機器上
其他以 `vscode-extension-tester` 為基礎的專案共用 `%TEMP%/test-resources` 這個 VS Code 下載快取，
而不是各自下載一份約 150MB 以上的獨立副本。有一點值得注意的差異：`test:ui` 與 `test:ui:demo`
都會在每次執行前明確刪除 `%TEMP%/test-resources` 底下的 `settings` 子資料夾（透過一段內嵌的
`node -e` 清理步驟）— 這並不會建立專案本機的快取，只是在每次呼叫前，重設共用快取內過時的
VS Code 使用者設定，因此共用快取的慣例依然成立。

## 已知限制

- **沒有專屬的 `mcp-server` 測試套件。** 不同於 PromptManager（其 `mcp-server` 套件有自己的
  Jest 設定與測試），本 repo 的 `mcp-server/` 套件目前沒有任何測試，也沒有 `test` 腳本。
- **UI 測試天生比單元測試更慢、更容易不穩定（flaky）**，原因與其他同系列專案文件中記載的相同 —
  它們透過合成的 Selenium 輸入來驅動真實的 Electron 應用程式。目前只有一個 `.ui.test.ts` 檔案
  存在，所以這個風險面很小，但仍應把任何 UI 測試失敗視為需要調查的訊號，而不是自動當作真正的
  回歸問題。
- **在 `src/test/` 底下，找不到任何不穩定測試（flaky-test）標記、重試邏輯，或「已知問題」／
  workaround 註解** — 針對整個 repo、對每個測試檔案執行
  `flaky|retry|retries|known issue|workaround|TODO|skip(|xdescribe|xit(`（不分大小寫）的
  grep，沒有找到任何符合結果。這與 PromptManager 的起點有明顯不同 — PromptManager 有記錄、
  刻意保留的 UI 測試 workaround（例如它的 dirty-editor 卡住修正，以及被移除的 hover E2E
  測試）— 這裡目前還沒有相對應的歷史可以記錄。
- **`sidebar-demo.visual.ts` 不是正確性測試。** 它是一段腳本化、經過錄製的走查，用來產生展示
  畫面／截圖（`test:ui:demo`），由 `recording.ts` 中的 `UiRecording` 輔助工具驅動。不應該把它
  解讀為在 `sidebar.ui.test.ts` 之外的額外 UI 測試覆蓋範圍。
- **`CodexExtractor.test.ts` 本身幾乎是空的（只有一個測試）。** 大量的 Codex 解析／擷取覆蓋
  範圍 — rollout 紀錄解析、注入 scaffolding 過濾、以 workspace 過濾的擷取、遞迴深度限制 —
  實際上是放在 `security/AngleBracketSanitization.test.ts` 裡面，因為那個檔案是圍繞著角括號
  清理（angle-bracket-sanitization）這個安全性議題逐步累積起來的，並在過程中吸收了大部分
  Codex 專屬的測試案例。任何想找「Codex 測試在哪裡」的人，都應該同時檢查這兩個檔案。
