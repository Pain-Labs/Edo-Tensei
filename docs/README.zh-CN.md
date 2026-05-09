# Edo Tensei – AI 会话交接管理器

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/Pain-Labs.edo-tensei)](https://marketplace.visualstudio.com/items?itemName=Pain-Labs.edo-tensei)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/Pain-Labs.edo-tensei)](https://marketplace.visualstudio.com/items?itemName=Pain-Labs.edo-tensei)
[![AI-Ready Context](https://img.shields.io/badge/AI--Ready-LLMS.txt-blue?style=flat-square)](https://pain-labs.github.io/Edo-Tensei/llms.txt)

[繁體中文](README.zh-TW.md) | [English](../README.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | 简体中文

![Edo Tensei – AI 会话交接管理器](https://raw.githubusercontent.com/Pain-Labs/Edo-Tensei/main/docs/assets/hero_banner.png)

---

## 什么是 Edo Tensei？

AI 额度在任务进行到一半时用完，切换到另一款 IDE 不应该意味着你要重新解释所有背景。

**Edo Tensei**（穢土転生）从你电脑上安装的各款 IDE 中提取本地 AI 对话记录，并打包成可直接粘贴的交接 Prompt — 让下一个 AI Agent 能从上一个停下的地方继续。

### 名称由来与逻辑

在《火影忍者》中，**穢土転生**（Edo Tensei）是一种禁术，能将死者的灵魂召唤回人间并束缚于活人容器中，使其恢复生前的记忆与能力。

本工具以此命名，象征着 AI 开发中的“上下文续命”：

- **死者 (The Deceased)**：因配额耗尽、IDE 崩溃或切换工具而“中断”的旧会话。
- **祭品/媒介 (The Vessel)**：本工具提取并封装的 **Handoff Prompt**。
- **转生 (The Reincarnation)**：将 Prompt 贴入新 IDE，让原本“死去”的开发思路在新的 AI 实体中完美重生。

![工作流程](https://raw.githubusercontent.com/Pain-Labs/Edo-Tensei/main/docs/assets/workflow_guide.png)

---

> **平台限制**：目前仅支持 Windows。macOS 与 Linux 尚未开发。

## 支持的 IDE

| IDE / Agent | 本地存储路径 | 备注 |
| :--- | :--- | :--- |
| GitHub Copilot Chat | `%APPDATA%/Code/User/…/chatSessions/` | JSON & JSONL |
| Cursor | `~/.cursor/projects/` | JSONL |
| Claude Code CLI | `~/.claude/projects/` | JSONL |
| OpenAI Codex CLI | `~/.codex/` | JSONL |
| Kiro | `%APPDATA%/Kiro/…/kiroagent/` | JSON（`.chat`） |
| Antigravity | `~/.gemini/antigravity/brain/` | 仅 Preview Log — 见已知限制 |

---

## 核心功能

- **多 IDE 提取**：自动扫描所有支持的 IDE，以 `IDE → 项目 → 会话` 三层结构呈现。
- **项目范围扫描**：「扫描项目会话」只列出与当前工作区匹配的对话记录。
- **两种交接模式**：
  - **路径模式**（默认）：输出会话文件路径 + 各 IDE 专属阅读指引。节省 token，接手端只读必要段落。
  - **全文模式**：嵌入完整对话内容。兼容性最广，但 token 消耗较高。
- **一键转生**：复制格式化的交接 Prompt 到剪贴板，直接粘贴进新的 AI 对话即可接手。
- **导出到 `.edo_tensei/`**：将交接 Prompt 存为 Markdown 文件，以 `IDE/项目/时间戳` 结构整理。
- **原始文件预览**：直接在 VS Code 中打开原始会话文件供查阅或手动编辑。
- **Agent Skill 生成器**：为 Claude Code、GitHub Copilot、Kiro、Antigravity、Cline、Gemini CLI 与 Cursor 生成可复用的 `edo-tensei` skill/rule 文件。
- **Model Context Protocol (MCP)**：内置 MCP 服务器，允许 AI Agent (Cursor, Copilot, Claude, Kiro, Antigravity) 以编程方式发现、读取和导出 Edo Tensei 会话。通过 "Show MCP Config" UI 即可轻松为特定 AI 生成配置。
- **`.gitignore` 助手**：首次导出时自动提示加入 `.edo_tensei/`，避免误提交到版本库。

![核心功能](https://raw.githubusercontent.com/Pain-Labs/Edo-Tensei/main/docs/assets/features.png)

---

## 快速开始

![Operation Guide](https://raw.githubusercontent.com/Pain-Labs/Edo-Tensei/main/docs/assets/ui_operation_guide.png)

1. 点击 VS Code 活动栏的 **Edo Tensei** 图标（裂痕文件夹图标）打开侧边栏。
2. 点击 **Scan (Current Project)** 或 **Scan (All Projects)** 寻找对话记录。
3. **直接点击某个 session** 即可瞬间将交接 Prompt 复制到剪贴板。
4. (选用) 右键点击 session 可使用 **进阶功能** (Advanced)，如导出或预览原始文件。
5. **粘贴** Prompt 到新的 IDE / AI Agent，继续任务。

---

## 设置

在 VS Code 设置中搜索 `edoTensei`。

| 设置 | 选项 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `edoTensei.handoffMode` | `path` / `fullText` | `path` | 推荐使用 `path` 以节省 token。 |
| `edoTensei.promptLanguage` | `English` / `Traditional Chinese` / `Simplified Chinese` / `Japanese` / `Korean` | `English` | 生成的交接 Prompt 语言。 |
| `edoTensei.customScanPaths` | 对象 `{ "claude": [], … }` | `{}` | 覆盖各 IDE 的默认扫描路径。 |

### 自定义扫描路径示例

```json
{
  "edoTensei.customScanPaths": {
    "claude": ["D:/custom-claude-projects"],
    "copilot": ["E:/another-vscode-profile/chatSessions"]
  }
}
```

---

## 命令列表

所有命令均可通过命令面板（`Ctrl+Shift+P`）在 `Edo Tensei` 分类下找到。

| 命令 | 说明 |
| :--- | :--- |
| Scan Project Sessions | 扫描符合当前工作区的会话 |
| Fetch ALL Historical Sessions | 扫描所有 IDE 的全部本地会话 |
| Copy Handoff Prompt | 复制选取会话的交接 Prompt |
| View Parsed Session | 以 Markdown 预览格式打开会话 |
| Preview Raw Session File | 打开原始会话文件 |
| Copy Raw File Path | 复制会话文件路径到剪贴板 |
| Export Session to .edo_tensei | 将交接 Prompt 保存为 Markdown 文件 |
| Export All Sessions to .edo_tensei | 将所有已扫描的会话导出 |
| Generate Agent Skill | 为其他 AI 工具生成可复用的 `edo-tensei` skill/rule 文件 |
| Show MCP Config | 打开 UI 面板，获取适用于你的 AI 代理的 MCP 服务器配置文件（可直接复制粘贴） |

---

## Model Context Protocol (MCP) Server

Edo Tensei 内置了 [Model Context Protocol](https://modelcontextprotocol.io/) 服务器，能让 AI Agent 在不离开对话界面的情况下，直接与你的历史记录进行交互。

AI Agent 不需要你手动导出或复制交接 Prompt，而是能自动探索过去的会话，读取完整的对话上下文，并无缝接续中断的工作流。

如何设置 MCP 服务器：
1. 运行 **Edo Tensei: Show MCP Config** 命令。
2. 选择你的 AI 工具 (Cursor, GitHub Copilot, Claude Code, Kiro 或 Antigravity)。
3. 选择你的 Workspace 设置偏好 (Recommended, Selected, Variable 或 All Workspaces)。
4. 复制生成的 JSON 片段，粘贴进 AI 工具的 MCP 配置文件中。

详细文档请参阅 [MCP Server README](../mcp-server/README.md)。

---

## Agent Skills

使用 **Generate Agent Skill** 可以为其他 AI 工具创建可复用的 `edo-tensei` skill 或 rule。生成的内容不是松散备忘，而是一份结构化 SOP：告诉接手代理如何定位可能的 session 文件、只读取最近且相关的片段、在置信度不足时停止，并输出干净的交接摘要。

支持的输出路径：

- Claude Code: `.claude/skills/edo-tensei/SKILL.md`
- GitHub Copilot: `.github/skills/edo-tensei/SKILL.md`
- Kiro IDE: `.kiro/skills/edo-tensei/SKILL.md`
- Antigravity: `.agents/skills/edo-tensei/SKILL.md`
- Cline: `.cline/skills/edo-tensei/SKILL.md`
- Gemini CLI: `.gemini/skills/edo-tensei/SKILL.md`
- Cursor: `.cursor/rules/edo-tensei.mdc`

说明：

- Cursor 使用 rule 文件，而不是 slash-command skill。
- 即使 workspace 中已经安装 `edo-tensei` skill/rule，交接 prompt 仍会附带手动读文件 fallback，因此在混合工具链中依然可用。

---

## 隐私与本地优先

Edo Tensei 完全**本地优先**。所有提取与解析均在你的电脑上执行，直接读取本地文件（SQLite、JSONL、JSON 或文本文件），不向任何外部服务器发送数据。

`.edo_tensei/` 导出文件夹会建立在工作区内，首次使用时扩展会提示你加入 `.gitignore`。

---

## 已知限制

- **macOS / Linux**：尚未支持。目前仅限 Windows 平台。
- **Trae**：尚未支持。本地数据库使用 SQLCipher 加密，目前无公开密钥可用。
- **Windsurf**：会话文件使用二进制 protobuf 格式。此前的仅路径 fallback 目前已停用，因此在可靠解析器完成前，Windsurf session 不会出现在扫描结果中。
- **Antigravity**：从 `overview.txt`（预览 log）提取，每条消息截断于约 900 字符。完整对话历史仅存于 Antigravity 云端，本地无法访问。

---

## 推荐搭配

### Quick Prompt

AI Agent 执行任务时，在 IDE 内随手记下下一步任务与可复用片段，无需切换窗口。

[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=winterdrive.quick-prompt) | [Open VSX Registry](https://open-vsx.org/extension/winterdrive/quick-prompt)

### VirtualTabs

跨任意目录，按任务整理文件，设置跨会话持久保留。

[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=winterdrive.virtual-tabs) | [Open VSX Registry](https://open-vsx.org/extension/winterdrive/virtual-tabs)

---

## 问题反馈

发现 Bug 了吗？请[提交 Issue](https://github.com/Pain-Labs/Edo-Tensei/issues)，并附上：

- 操作系统版本（例如 Windows 11 22H2）
- 来源 IDE 及尝试提取的 session
- 复现步骤

---

## 欢迎贡献

欢迎任何形式的贡献！可以直接开 [Pull Request](https://github.com/Pain-Labs/Edo-Tensei/pulls) 或在 [Issues](https://github.com/Pain-Labs/Edo-Tensei/issues) 发起讨论。

以下几个方向特别需要帮助：

- **新增 IDE 提取器** — 尤其是 macOS / Linux 路径支持
- **Windsurf / Trae** — 如果你对它们的 session 格式有研究
- **翻译** — 改善或新增本地化 README

---

## 更新日志

完整版本记录请见 [CHANGELOG.md](../CHANGELOG.md)。

---

## 许可证

[MIT](../LICENSE)
