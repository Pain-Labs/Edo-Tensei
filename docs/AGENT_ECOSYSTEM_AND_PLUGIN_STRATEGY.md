# AI Agent 跨生態分發策略與實作邊界

> **狀態**：跨專案策略 SSOT
>
> **維護位置**：`Pain-Labs/Edo-Tensei/docs/AGENT_ECOSYSTEM_AND_PLUGIN_STRATEGY.md`
>
> **適用專案**：Edo Tensei、VirtualTabs、QuickPrompt
>
> **最後查證**：2026-08-27

## 1. 核心判斷

合理目標不是字面上的「Build Once, Distribute Everywhere」，而是：

> **Build the capability once; package, constrain, and verify it per ecosystem.**

Agent Skill 可以重用工作流程與判斷規則；MCP 可以重用工具協定；但 manifest、runtime、權限模型、安裝方式、審查流程與支援平台仍必須逐一處理。未經該 repository 的程式碼與安裝驗證，不得將「已有 Skill／MCP 原型」寫成「已可上架」。

本文件是三個專案的跨生態策略 SSOT。其他 repository 只保留連結與自身實作差異，避免複製整篇後漂移。

## 2. 生態與封裝層

| 目標 | Portable floor | 生態專屬封裝 | 重要限制 |
|---|---|---|---|
| Agent Plugins 1.0 clients | root `plugin.json`、固定位置的 `skills/`、選用 `mcp.json` | reverse-domain extension namespace | Skill-only 是合法且較小的首發形態；`mcp.json` 並非必填 |
| GitHub Copilot / Awesome Copilot | Agent Plugins package | external plugin intake metadata | 公開送件目前要求 public GitHub repo 與 immutable `ref`／完整 SHA；自動執行 Vally 與 install smoke test |
| Claude Code / Claude Desktop | 可重用 `skills/` | `.claude-plugin/plugin.json`、選用 MCP bundle/config | Claude 的 manifest 路徑與 Agent Plugins root manifest 不相同 |
| OpenAI ChatGPT / Codex | skills-only、MCP-only 或兩者 | `.codex-plugin/plugin.json`，依能力選用 `.app.json`／`.mcp.json` | ChatGPT 與 Codex 共用 universal plugin directory，但 capability 可以只支援特定 surface |
| MCP registries | 可安裝的 MCP runtime 或 remote endpoint | 各 registry metadata | 有 tool definitions 不等於有可發布 runtime；必須先完成 artifact 與 extractor parity |

## 3. Manifest 路徑不可混用

```text
Agent Plugins 1.0
plugin.json
skills/<skill-name>/SKILL.md
mcp.json                         # optional

Claude plugin
.claude-plugin/plugin.json
skills/<skill-name>/SKILL.md
.mcp.json                       # ecosystem-specific, when needed

OpenAI universal plugin
.codex-plugin/plugin.json
skills/<skill-name>/SKILL.md
.app.json or .mcp.json          # capability-dependent
```

Agent Plugins 1.0 的 root `plugin.json` 是 closed schema。只可使用 `$schema`、`name`、`version`、`description`、`author`、`homepage`、`repository`、`license`、`keywords`、`extensions`。客戶端資料應放在 `extensions`，不能自行新增 top-level fields。

若未來加入 Agent Plugins 1.0 `mcp.json`：

- `$schema` 必須是 `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json`。
- stdio entry 必須明示 `"type": "stdio"`。
- plugin-relative path 使用 `${PLUGIN_ROOT}`，不是 `${pluginDir}`。
- 宣告前必須證明 immutable source 內含可執行 artifact，或有可重現且受支援的安裝／build runner。

## 4. Edo Tensei 的已查證狀態

### Phase 1：Skill-only Agent Plugin

目前可交付內容：

- root `plugin.json`
- `skills/edo-tensei/SKILL.md` 與其 `session-*.md` references
- Windows-only support matrix
- schema、Vally、reference completeness 與 clean install smoke tests

此階段刻意不含 `mcp.json`。Skill 直接讀取本機 session files，不依賴 VS Code extension 或 MCP server。

### Phase 2：MCP enhancement

加入公開 plugin 前仍需完成：

- #92：以 production extractors 取代 MCP placeholder scanning，加入真實 fixtures，讓 session messages、message count 與全文搜尋行為可驗證。
- #93：提供 immutable source 可重現的 standalone runtime；不能依賴被 `.gitignore` 排除、tag 內不存在的 `dist/`。

目前 MCP server 的 tool definitions 與 UI 整合是工程資產，但不是 registry-ready 或 Agent Plugin-ready 的充分證據。

### 平台邊界

公開支援維持 **Windows only**。macOS／Linux 路徑可以留作研究或人工參考，但在 #2 完成並通過對應 fixture、filesystem 與 install tests 前，不列入支援矩陣。

## 5. VirtualTabs 與 QuickPrompt

兩個專案沿用同一決策框架，但本文件不宣稱其目前已 ready。各 repository 必須自行確認：

1. Skill 能否在沒有 extension UI 的情況下完成核心工作。
2. MCP 是否使用 production implementation，而非 placeholder 或較弱的重複實作。
3. immutable source 是否真的包含可啟動 runtime。
4. 支援平台是否有實際 fixtures 與 clean-install evidence。
5. manifest 路徑、schema 與 placeholder 是否符合目標生態。

完成 repo-local audit 後，將結果寫在該 repo 的 issue／implementation document，這裡只維護共同策略與規範。

## 6. 發布閘門

公開提交前依序完成：

1. schema validation：manifest 可由官方 1.0.0 schema 驗證。
2. Vally lint：所有公開 skills 無 frontmatter、reference 或 instruction structure 錯誤。
3. clean source install：在沒有原工作目錄、`node_modules`、ignored `dist` 與 owner-only settings 的環境安裝成功。
4. acceptance scenarios：至少涵蓋 current-project latest session、specified IDE、binary／permission stop rule。
5. security review：不追蹤 owner path、credentials、private session content 或會任意擴權的步驟。
6. version alignment：plugin manifest、產品版本與 intake metadata 一致。
7. immutable source：發布 release tag 或提交完整 commit SHA。
8. marketplace／registry submission。

本階段只做到第 6 項；第 7、8 項必須另行授權與執行。

## 7. 官方參考

- [Agent Plugins Specification 1.0.0](https://agent-plugins.org/specification)
- [Agent Plugins manifest schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json)
- [VS Code: Agent plugins](https://code.visualstudio.com/docs/agent-customization/agent-plugins)
- [Awesome Copilot: Contributing / external plugin intake](https://github.com/github/awesome-copilot/blob/main/CONTRIBUTING.md#adding-external-plugins)
- [OpenAI: Plugins concepts](https://developers.openai.com/plugins/concepts/plugins)
- [OpenAI: Build plugins](https://developers.openai.com/plugins/build/plugins)
- [OpenAI: Submit to the plugin directory](https://developers.openai.com/plugins/deploy/submission)
