# Edo Tensei – AI 会话交接管理器

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/Pain-Labs.edo-tensei)](https://marketplace.visualstudio.com/items?itemName=Pain-Labs.edo-tensei)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/Pain-Labs.edo-tensei)](https://marketplace.visualstudio.com/items?itemName=Pain-Labs.edo-tensei)
[![AI-Ready Context](https://img.shields.io/badge/AI--Ready-LLMS.txt-blue?style=flat-square)](https://pain-labs.github.io/Edo-Tensei/llms.txt)

[繁體中文](README.zh-TW.md) | [English](../README.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | 简体中文

![Edo Tensei – AI 会话交接管理器](assets/hero_banner.png)

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

![工作流程](./assets/workflow_guide.png)

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
| Windsurf | `~/.codeium/windsurf/cascade/` | 二进制格式，仅支持路径模式 |
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
- **`.gitignore` 助手**：首次导出时自动提示加入 `.edo_tensei/`，避免误提交到版本库。

![核心功能](./assets/features.png)

---

## 快速开始

1. 点击 VS Code 活动栏的 **Edo Tensei** 图标（归档图标）打开侧边栏。
2. 点击**扫描项目会话**寻找与当前工作区匹配的记录，或点击**获取所有历史会话**进行全局扫描。
3. 在树状结构中按 IDE 浏览会话。
4. 右键点击某个会话，选择**复制交接 Prompt**。
5. 粘贴进新的 IDE / AI Agent，继续任务。

![界面概览](./assets/ui_sidebar_overview.png)

---

## 设置

在 VS Code 设置中搜索 `edoTensei`。

| 设置 | 选项 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `edoTensei.handoffMode` | `path` / `fullText` | `path` | 推荐使用 `path` 以节省 token。 |
| `edoTensei.promptLanguage` | `English` / `Traditional Chinese` | `English` | 生成的交接 Prompt 语言。 |
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

---

## 隐私与本地优先

Edo Tensei 完全**本地优先**。所有提取与解析均在你的电脑上执行，直接读取本地文件（SQLite、JSONL、JSON 或文本文件），不向任何外部服务器发送数据。

`.edo_tensei/` 导出文件夹会建立在工作区内，首次使用时扩展会提示你加入 `.gitignore`。

---

## 已知限制

- **macOS / Linux**：尚未支持。目前仅限 Windows 平台。
- **Trae**：尚未支持。本地数据库使用 SQLCipher 加密，目前无公开密钥可用。
- **Windsurf**：会话文件使用二进制 protobuf 格式。Edo Tensei 仅支持**路径模式** — 复制路径与阅读指引，无法嵌入完整对话。
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

## 更新日志

完整版本记录请见 [CHANGELOG.md](../CHANGELOG.md)。

---

## 许可证

[MIT](../LICENSE)
