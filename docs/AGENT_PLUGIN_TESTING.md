# Agent Plugin 驗收指南

本文件定義 Edo Tensei Agent Plugins 1.0 首發包的驗收範圍。首發包是 **Skill-only**：根目錄包含 `plugin.json` 與 `skills/edo-tensei/`，刻意不包含 `mcp.json`。公開支援範圍目前為 **Windows only**。

## 自動品質閘

在 repository root 執行：

```powershell
npm run typecheck
npm run test:unit
```

另外必須以 Awesome Copilot intake 使用的 `npx --yes @microsoft/vally-cli@^0.12.0 lint skills/edo-tensei/ --strict` 執行 lint，並以 Agent Plugins 1.0 官方 schema 驗證 `plugin.json`。驗證結果須同時滿足：

- `plugin.json` 使用 canonical `$schema`，且只包含規格允許的欄位。
- `plugin.json.version` 與 `package.json.version` 相同。
- `skills/edo-tensei/SKILL.md` 能通過 Vally。
- Skill 內所有相對 Markdown references 都存在於套件中。
- 根目錄不存在 `mcp.json`；MCP enhancement 等 #92 與 #93 完成後另行加入。

## Skill-only 驗收情境

### A. 目前專案的最新 session

**Given**：Windows 上目前 workspace 有至少一筆可解析 session，且另一個專案有更新但不相關的 session。

**When**：使用者要求「接續目前專案最近的工作」，未指定 IDE。

**Then**：Skill 先以 normalized absolute workspace path 篩選，再從相符結果取最新 session；不得因為其他專案的檔案時間較新而誤選。輸出符合 `Session Handoff Summary` contract。

### B. 指定 IDE 的 session

**Given**：目前專案在多個 IDE 都有 session。

**When**：使用者要求「接續 Cursor 的 session」。

**Then**：只搜尋 Cursor。若 Cursor 沒有可確認屬於目前 workspace 的 session，回報未找到及已檢查路徑；未經使用者同意不得 fallback 到 Claude、Copilot 或其他 IDE。

### C. Binary 或權限受阻的來源

**Given**：候選來源為 Windsurf binary、Trae SQLite，或檔案因權限而不可讀，且沒有可用的 documented reader。

**When**：Skill 嘗試取得該 session。

**Then**：回報確切路徑、資料型態或權限限制並停止；不得猜測 session 內容、不得靜默改選其他專案，也不得修改檔案權限。

### D. 同名 workspace 歧義

**Given**：兩個不同 absolute paths 的 workspace basename 相同，且兩者都有候選 session。

**When**：session metadata 無法唯一對應目前 workspace。

**Then**：列出精簡候選清單並請使用者選擇，不自行猜測。

### E. Git linked worktree repository fallback

**Given**：目前 workspace 是 Git linked worktree，沒有 exact-path session；primary checkout 或其他 worktree 有相同 Git common directory 的 session。

**When**：Skill 找不到 normalized absolute path 完全相符的候選。

**Then**：以唯讀 `git rev-parse --path-format=absolute --git-common-dir` 比較 repository identity。只有一個 candidate workspace 時可選擇其最新 session，並揭露使用 repository-level fallback；若同 repository 仍有多個 workspace 候選，必須列出並詢問。不得以 remote URL、basename 或修改時間單獨判定。

## 2026-08-28 手動驗收紀錄

- Scenario A：一般 checkout 能選中目前專案的最新 Claude Code session，並輸出中文 handoff。
- Scenario B：指定 Codex 後只搜尋 Codex，並選中該 workspace 最新 session。
- Scenario C：Windsurf binary session 回報完整路徑與格式限制後停止，未猜測內容或 fallback。
- Scenario D：兩個同 basename、不同 absolute paths 的 synthetic Claude Code sessions 會先要求選擇；選擇 Candidate A 後正確讀取 `A_READY`。
- 測試 fixture 與 synthetic session 已在驗收後刪除，未留下私人 session 內容或 owner-specific tracked path。

## 乾淨來源安裝 smoke test

1. 從預定提交內容建立不含 `node_modules`、`dist` 與本機設定的乾淨 Git snapshot。
2. 在 VS Code 執行 **Chat: Install Plugin From Source**。
3. 輸入該 snapshot 的本機 Git repository path；公開 intake 前改用 immutable Git ref 或完整 commit SHA。
4. 在 **Agent Plugins - Installed** 確認 `edo-tensei` 已出現。
5. 檢查安裝內容含 `plugin.json`、`skills/edo-tensei/SKILL.md` 與所有 `session-*.md` references，且不含 `mcp.json`。

實際公開 intake 仍必須使用 public GitHub repository 的 immutable `ref` 或完整 commit SHA。建立 immutable release tag 與送件不屬於本階段。
