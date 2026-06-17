# Edo Tensei – AI Session 交接管理器

[![Visual Studio Marketplace Version](https://vsmarketplacebadges.dev/version-short/Pain-Labs.edo-tensei.svg)](https://marketplace.visualstudio.com/items?itemName=Pain-Labs.edo-tensei)
[![Open VSX Version](https://img.shields.io/open-vsx/v/Pain-Labs/edo-tensei)](https://open-vsx.org/extension/Pain-Labs/edo-tensei)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/Pain-Labs/edo-tensei)](https://open-vsx.org/extension/Pain-Labs/edo-tensei)
[![AI-Ready Context](https://img.shields.io/badge/AI--Ready-LLMS.txt-blue?style=flat-square)](https://pain-labs.github.io/Edo-Tensei/llms.txt)
<!-- [![VS Marketplace Installs](https://vsmarketplacebadges.dev/installs-short/Pain-Labs.edo-tensei.svg)](https://marketplace.visualstudio.com/items?itemName=Pain-Labs.edo-tensei) -->
<!-- [![VS Marketplace Downloads](https://vsmarketplacebadges.dev/downloads-short/Pain-Labs.edo-tensei.svg)](https://marketplace.visualstudio.com/items?itemName=Pain-Labs.edo-tensei) -->

繁體中文 | **[English](../README.md)** | [日本語](README.ja.md) | [한국어](README.ko.md) | [简体中文](README.zh-CN.md)

![Edo Tensei – AI Session 交接管理器](https://raw.githubusercontent.com/Pain-Labs/Edo-Tensei/main/docs/assets/hero_banner.png)

---

## 什麼是 Edo Tensei？

AI 額度在任務進行到一半時用完，切換到另一款 IDE 不應該代表你要重新解釋所有背景。

**Edo Tensei**（穢土轉生）從你電腦上安裝的各款 IDE 中提取本機 AI 對話紀錄，並打包成可直接貼上的交接 Prompt — 讓下一個 AI Agent 能從上一個停下的地方繼續。

### 名稱由來與邏輯

在《火影忍者》中，**穢土轉生**（Edo Tensei）是一種禁術，能將死者的靈魂召喚回人間並束縛於活人容器中，使其恢復生前的記憶與能力。

本工具以此命名，象徵著 AI 開發中的「上下文續命」：

- **死者 (The Deceased)**：因配額耗盡、IDE 崩潰或切換工具而「中斷」的舊會話。
- **祭品/媒介 (The Vessel)**：本工具提取並封裝的 **Handoff Prompt**。
- **轉生 (The Reincarnation)**：將 Prompt 貼入新 IDE，讓原本「死去」的開發思路在新的 AI 實體中完美重生。

![流程示意圖](https://raw.githubusercontent.com/Pain-Labs/Edo-Tensei/main/docs/assets/workflow_guide.png)

---

> **平台限制**：目前僅支援 Windows。macOS 與 Linux 尚未開發。

## 支援的 IDE

| IDE / Agent | 本機儲存路徑 | 備注 |
| :--- | :--- | :--- |
| GitHub Copilot Chat | `%APPDATA%/Code/User/…/chatSessions/` | JSON & JSONL |
| Cursor | `~/.cursor/projects/` | JSONL |
| Claude Code CLI | `~/.claude/projects/` | JSONL |
| OpenAI Codex CLI | `~/.codex/` | JSONL |
| Kiro | `%APPDATA%/Kiro/…/kiroagent/` | JSON（`.chat`） |
| Antigravity | `~/.gemini/antigravity/brain/` | 僅 Preview Log — 見已知限制 |

---

## 核心功能

- **按 IDE 隨需掃描**：展開任一 IDE 即只掃描該 IDE 的本機 session，避免開啟側邊欄時一次做大量磁碟 I/O。也可使用工具列 ⚡ **Scan All IDEs** 一次掃描全部。
- **分頁載入**：每個 IDE 最多先顯示 300 筆 session；若還有更多紀錄，底部會出現 **Load More**，讓大量歷史紀錄仍保持流暢。
- **兩種交接模式**：
  - **路徑模式**（預設）：輸出 session 檔案路徑 + 各 IDE 專屬閱讀指引。省 token，接手端只讀必要段落。
  - **全文模式**：嵌入完整對話內容。相容性最廣，但 token 消耗較高。
- **一鍵穢土轉生**：複製格式化的交接 Prompt 到剪貼簿，直接貼進新的 AI 對話即可接手。
- **匯出到 `.edo_tensei/`**：將交接 Prompt 存成 Markdown 檔，以 `IDE/專案/時間戳記` 結構整理。
- **原始檔預覽**：直接在 VS Code 中開啟原始 session 檔案供查閱或手動編輯。
- **Agent Skill 安裝器**：執行 **Edo Tensei: 安裝 Agent Skill** 安裝正式 `edo-tensei` skill。只有需要自行寫入指定 agent 的 skill/rule 檔案時，才使用 **Generate Skill Files Manually**。
- **Model Context Protocol (MCP)**：內建 MCP 伺服器，允許 AI Agent (Cursor, Copilot, Claude, Kiro, Antigravity) 以程式化方式探索、讀取與匯出 Edo Tensei sessions。透過 "Show MCP Config" UI 即可輕鬆為特定 AI 產生配置。
- **`.gitignore` 小幫手**：首次匯出時自動提示加入 `.edo_tensei/`，避免誤提交到版本庫。

![核心功能](https://raw.githubusercontent.com/Pain-Labs/Edo-Tensei/main/docs/assets/features.png)

---

## 快速開始

![Edo Tensei 產品示範](https://raw.githubusercontent.com/Pain-Labs/Edo-Tensei/main/docs/assets/edo-tensei-product-demo.gif)

1. 點擊 VS Code Activity Bar 的 **Edo Tensei** 圖示（裂痕資料夾圖示）開啟側邊欄。
2. **展開某個 IDE**，第一次展開時只會掃描該 IDE。也可使用工具列 ⚡ **Scan All IDEs** 一次掃描全部 IDE。
3. 如果該 IDE 還有更多 sessions，點擊底部 **Load More** 載入下一頁。
4. **直接點擊某個 session** 即可瞬間將交接 Prompt 複製到剪貼簿。
5. (選用) 右鍵點擊 session 可使用 **進階功能** (Advanced)，如匯出或預覽原始檔；IDE 列上的 **Export All** 按鈕可匯出該 IDE 的所有 sessions。
6. **貼上** Prompt 到新的 IDE / AI Agent，繼續任務。

---

## 設定

在 VS Code 設定中搜尋 `edoTensei`。

| 設定 | 選項 | 預設值 | 說明 |
| :--- | :--- | :--- | :--- |
| `edoTensei.handoffMode` | `path` / `fullText` | `path` | 推薦使用 `path` 以節省 token。 |
| `edoTensei.promptLanguage` | `English` / `Traditional Chinese` / `Simplified Chinese` / `Japanese` / `Korean` | `English` | 產生的交接 Prompt 語言。 |
| `edoTensei.customScanPaths` | 物件 `{ "claude": [], … }` | `{}` | 覆蓋各 IDE 的預設掃描路徑。 |

### 自訂掃描路徑範例

```json
{
  "edoTensei.customScanPaths": {
    "claude": ["D:/custom-claude-projects"],
    "copilot": ["E:/another-vscode-profile/chatSessions"]
  }
}
```

---

## 指令列表

所有指令均可透過指令面板（`Ctrl+Shift+P`）在 `Edo Tensei` 分類下找到。

| 指令 | 說明 |
| :--- | :--- |
| Scan All IDEs | 掃描所有 IDE 的全部本機 sessions（工具列 ⚡ 按鈕） |
| Refresh This IDE | 重新掃描單一 IDE（IDE 列上的 inline 按鈕） |
| Load More Sessions | 載入該 IDE 的下一頁 sessions |
| Copy Handoff Prompt | 複製選取 session 的交接 Prompt |
| View Parsed Session | 以 Markdown 預覽格式開啟 session |
| Preview Raw Session File | 開啟原始 session 檔案 |
| Copy Raw File Path | 複製 session 檔案路徑到剪貼簿 |
| Export Session to .edo_tensei | 將交接 Prompt 儲存為 Markdown 檔 |
| Export All Sessions to .edo_tensei | 將指定 IDE 的所有 sessions 匯出到 `.edo_tensei/`（IDE 列上的 inline 按鈕） |
| 安裝 Agent Skill | 安裝正式 `edo-tensei` skill；只有需要指定 agent 檔案時，才在命令內使用 **Generate Skill Files Manually** |
| Show MCP Config | 開啟 UI 面板，取得適用於你的 AI 代理的 MCP 伺服器設定檔 (可直接複製貼上) |

---

## Model Context Protocol (MCP) Server

Edo Tensei 內建了 [Model Context Protocol](https://modelcontextprotocol.io/) 伺服器，能讓 AI Agent 在不離開對話介面的情況下，直接與你的歷史紀錄進行互動。

AI Agent 不需要你手動匯出或複製交接 Prompt，而是能自動探索過去的 sessions，讀取完整的對話上下文，並無縫接續中斷的工作流。

如何設定 MCP 伺服器：

1. 執行 **Edo Tensei: Show MCP Config** 指令。
2. 選擇你的 AI 工具 (Cursor, GitHub Copilot, Claude Code, Kiro 或 Antigravity)。
3. 選擇你的 Workspace 設定偏好 (Recommended, Selected, Variable 或 All Workspaces)。
4. 複製產生的 JSON 片段，貼入 AI 工具的 MCP 設定檔中。

詳細文件請參閱 [MCP Server README](../mcp-server/README.md)。

---

## Agent Skills

執行 **Edo Tensei: 安裝 Agent Skill**，選擇 **Auto Install (Recommended)** 安裝正式 `edo-tensei` skill。也可以直接執行 `npx skills add Pain-Labs/Edo-Tensei`。只有需要自行寫入指定 agent 的 skill/rule 檔案時，才選 **Generate Skill Files Manually**。產生出的內容不是零散備忘錄，而是一份結構化 SOP：告訴接手代理如何定位可能的 session 檔案、只讀最近且相關的片段、在信心不足時停止，並輸出乾淨的交接摘要。

支援的輸出位置：

- Claude Code: `.claude/skills/edo-tensei/SKILL.md`
- GitHub Copilot: `.github/skills/edo-tensei/SKILL.md`
- Kiro IDE: `.kiro/skills/edo-tensei/SKILL.md`
- Antigravity: `.agents/skills/edo-tensei/SKILL.md`
- Cline: `.cline/skills/edo-tensei/SKILL.md`
- Gemini CLI: `.gemini/skills/edo-tensei/SKILL.md`
- Cursor: `.cursor/rules/edo-tensei.mdc`

注意事項：

- Cursor 使用 rule 檔，不是 slash-command skill。
- 即使 workspace 已安裝 `edo-tensei` skill/rule，交接 prompt 仍會附上手動讀檔 fallback，因此在混合工具鏈中仍可直接使用。

---

## 隱私與本機優先

Edo Tensei 完全**本機優先**。所有提取與解析均在你的電腦上執行，直接讀取本機檔案（SQLite、JSONL、JSON 或文字檔），不傳送任何資料至外部伺服器。

`.edo_tensei/` 匯出資料夾會建立在 workspace 內，首次使用時擴充功能會提示你加入 `.gitignore`。

---

## 已知限制

- **macOS / Linux**：尚未支援。目前僅限 Windows 平台。
- **Trae**：尚未支援。本機資料庫使用 SQLCipher 加密，目前無公開金鑰可用。
- **Windsurf**：Session 檔案使用二進位 protobuf 格式。先前的僅路徑 fallback 目前已停用，因此在可靠解析器完成前，Windsurf session 不會出現在掃描結果中。
- **Antigravity**：從 `overview.txt`（預覽 log）提取，每則訊息截斷於約 900 字元。完整對話歷史僅存於 Antigravity 雲端，本機無法存取。

---

## 推薦搭配

### Quick Prompt

AI Agent 執行任務時，在 IDE 內隨手記下下一步任務與可重用片段，不需切換視窗。

[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=winterdrive.quick-prompt) | [Open VSX Registry](https://open-vsx.org/extension/winterdrive/quick-prompt)

### VirtualTabs

跨任意目錄，依任務整理檔案，設定跨 session 持久保留。

[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=winterdrive.virtual-tabs) | [Open VSX Registry](https://open-vsx.org/extension/winterdrive/virtual-tabs)

---

## 回報 Bug

發現問題了嗎？請[開一個 Issue](https://github.com/Pain-Labs/Edo-Tensei/issues)，並附上：

- 作業系統版本（例如 Windows 11 22H2）
- 來源 IDE 及嘗試提取的 session
- 重現步驟

---

## 歡迎貢獻

非常歡迎各種形式的貢獻！請直接開 [Pull Request](https://github.com/Pain-Labs/Edo-Tensei/pulls) 或在 [Issues](https://github.com/Pain-Labs/Edo-Tensei/issues) 發起討論。

以下幾個方向特別需要幫助：

- **新增 IDE 提取器** — 尤其是 macOS / Linux 路徑支援
- **Windsurf / Trae** — 如果你對它們的 session 格式有研究
- **翻譯** — 改善或新增本地化 README

---

## 更新日誌

完整版本紀錄請見 [CHANGELOG.md](../CHANGELOG.md)。

---

## 授權

[MIT](../LICENSE)
