/**
 * Handoff generation and export tools for MCP server
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ErrorType, HandoffPromptResult, ExportResult, ToolResponse } from '../types.js';
import { createSuccess, createError, createNotFoundError, createInvalidParamsError } from '../utils/ResponseFactory.js';
import { Logger } from '../utils/Logger.js';

// IDE 讀取指引
const IDE_READ_GUIDES: Record<string, string> = {
  copilot: [
    'Format: JSON / JSONL (chatSessions)',
    '- JSON: root has `requests[]`, each with `message.text` (user) and `response[]` (assistant)',
    '- JSONL: each line is a snapshot with `sessionId`, `requests[]`, `customTitle`',
    '- Use last snapshot per sessionId for the most complete state',
  ].join('\n'),
  cursor: [
    'Format: JSONL (agent-transcripts)',
    '- Each line: `{"role":"user"/"assistant", "message":{"content":[{"type":"text","text":"..."}]}}`',
    '- Project slug format: path with slashes/colons → dashes, lowercase drive letter (Windows)',
  ].join('\n'),
  claude: [
    'Format: JSONL',
    '- Each line: `{"role":"user"/"assistant", "content":"...", "timestamp":"..."}`',
    '- Also look for `thought` field on assistant messages (reasoning content)',
  ].join('\n'),
  kiro: [
    'Format: JSON (.chat file)',
    '- Root has `chat[]` → each item has `role` ("user"/"bot") and `content` (string)',
    '- Note: system prompt and instructions appear at the start; skip to user/bot turns',
  ].join('\n'),
  antigravity: [
    'Format: JSONL (transcript.jsonl or overview.txt, preview-only log)',
    '- Each line has `source` ("USER"/"MODEL") and `input` or `content` field',
    '- ⚠ Content is truncated at ~900 chars per message; full history lives in the cloud only',
  ].join('\n'),
  codex: [
    'Format: JSONL',
    '- Each line has `type` and `payload`',
    '- Look for lines where `type` indicates a message or conversation turn',
  ].join('\n'),
  windsurf: [
    'Format: Binary (encrypted)',
    '- ⚠ Cannot be read externally. Use fullText mode only.',
  ].join('\n'),
  trae: [
    'Format: Binary (encrypted)',
    '- ⚠ Cannot be read externally. Use fullText mode only.',
  ].join('\n'),
};

// 多語言提示詞
const PROMPT_TEMPLATES: Record<string, Record<string, string>> = {
  path: {
    English: `You are taking over an existing task from {ide}.

📁 **Session File**: 
<code>{filePath}</code>

📝 **How to Read**:
{guide}

💡 **Instructions**:
1. Read the session file above using your file access capability
2. Continue the conversation from where it left off
3. Review the context carefully before making changes`,
    'Traditional Chinese': `你正在接手一個來自 {ide} 的既有任務。

📁 **Session 檔案**: 
<code>{filePath}</code>

📝 **讀取方式**:
{guide}

💡 **指示**:
1. 使用你的檔案存取能力讀取上述 session 檔案
2. 從對話中斷處繼續
3. 進行變更前請仔細審閱上下文`,
    'Simplified Chinese': `你正在接手一个来自 {ide} 的既有任务。

📁 **Session 文件**: 
<code>{filePath}</code>

📝 **读取方式**:
{guide}

💡 **指示**:
1. 使用你的文件访问能力读取上述 session 文件
2. 从对话中断处继续
3. 进行变更前请仔细审阅上下文`,
    Japanese: `{ide} からの既存タスクを引き継ぎます。

📁 **Session ファイル**: 
<code>{filePath}</code>

📝 **読み取り方法**:
{guide}

💡 **指示**:
1. ファイルアクセス機能を使用して上記の session ファイルを読み取ってください
2. 会話が途切れたところから続けてください
3. 変更を行う前に、コンテキストを注意深く確認してください`,
    Korean: `{ide}의 기존 작업을 인계받습니다.

📁 **Session 파일**: 
<code>{filePath}</code>

📝 **읽는 방법**:
{guide}

💡 **지침**:
1. 파일 접근 기능을 사용하여 위의 session 파일을 읽으세요
2. 대화가 중단된 지점에서 계속하세요
3. 변경 전 컨텍스트를 주의 깊게 검토하세요`,
  },
  fullText: {
    English: `You are taking over an existing task from {ide}.

📋 **Conversation History**:

{messages}

---

💡 **Instructions**:
1. Review the conversation history above
2. Continue the task from where it left off
3. Acknowledge what has been done before proceeding`,
    'Traditional Chinese': `你正在接手一個來自 {ide} 的既有任務。

📋 **對話歷史**:

{messages}

---

💡 **指示**:
1. 審閱上述對話歷史
2. 從中斷處繼續任務
3. 在繼續之前確認已完成的工作`,
    'Simplified Chinese': `你正在接手一个来自 {ide} 的既有任务。

📋 **对话历史**:

{messages}

---

💡 **指示**:
1. 审阅上述对话历史
2. 从中断处继续任务
3. 在继续之前确认已完成的工作`,
    Japanese: `{ide} からの既存タスクを引き継ぎます。

📋 **会話履歴**:

{messages}

---

💡 **指示**:
1. 上記の会話履歴を確認してください
2. 途切れたところからタスクを続けてください
3. 続行する前に、完了した作業を確認してください`,
    Korean: `{ide}의 기존 작업을 인계받습니다.

📋 **대화 기록**:

{messages}

---

💡 **지침**:
1. 위의 대화 기록을 검토하세요
2. 중단된 지점에서 작업을 계속하세요
3. 계속하기 전에 완료된 작업을 확인하세요`,
  },
};

export class HandoffTools {
  private workspaceRoot: string | undefined;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot;
  }

  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
  }

  /**
   * 生成 handoff prompt
   */
  async generateHandoffPrompt(args: {
    sessionId: string;
    mode: 'path' | 'fullText';
    language?: 'English' | 'Traditional Chinese' | 'Simplified Chinese' | 'Japanese' | 'Korean';
    messages?: Array<{ role: string; content: string; thought?: string }>;
    filePath?: string;
    ide?: string;
  }): Promise<ToolResponse<HandoffPromptResult>> {
    try {
      const { sessionId, mode, language = 'English', messages = [], filePath, ide = 'unknown' } = args;

      if (!sessionId) {
        return createInvalidParamsError('sessionId is required');
      }

      if (!['path', 'fullText'].includes(mode)) {
        return createInvalidParamsError('mode must be "path" or "fullText"');
      }

      // 從 sessionId 解析 ide (如果沒有提供)
      const [parsedIde] = sessionId.split(':');
      const actualIde = ide !== 'unknown' ? ide : (parsedIde || 'unknown');

      // 估算 tokens (char count / 3.5)
      let estimatedTokens = 0;
      for (const msg of messages) {
        estimatedTokens += Math.round((msg.content?.length || 0) / 3.5);
        estimatedTokens += Math.round((msg.thought?.length || 0) / 3.5);
      }

      let prompt: string;

      if (mode === 'path' && filePath) {
        // Path mode
        const guide = IDE_READ_GUIDES[actualIde] || IDE_READ_GUIDES.copilot;
        const template = PROMPT_TEMPLATES.path[language] || PROMPT_TEMPLATES.path.English;

        prompt = template
          .replace('{ide}', actualIde)
          .replace('{filePath}', filePath)
          .replace('{guide}', guide);
      } else {
        // Full text mode
        const formattedMessages = this.formatMessages(messages, language);
        const template = PROMPT_TEMPLATES.fullText[language] || PROMPT_TEMPLATES.fullText.English;

        prompt = template
          .replace('{ide}', actualIde)
          .replace('{messages}', formattedMessages);
      }

      return createSuccess({
        prompt,
        mode,
        language,
        estimatedTokens
      });
    } catch (error) {
      Logger.logError('generateHandoffPrompt', error);
      return createError(ErrorType.INTERNAL_ERROR, `Failed to generate handoff prompt: ${error}`);
    }
  }

  /**
   * 匯出 session 到 .edo_tensei/ 目錄
   */
  async exportSession(args: {
    sessionId: string;
    targetWorkspace?: string;
    sessionData?: {
      ide: string;
      title?: string;
      workspacePath?: string;
      capturedAt: string;
      messages: Array<{ role: string; content: string; thought?: string; timestamp?: string }>;
    };
  }): Promise<ToolResponse<ExportResult>> {
    try {
      const { sessionId, targetWorkspace, sessionData } = args;

      if (!sessionId) {
        return createInvalidParamsError('sessionId is required');
      }

      const workspacePath = targetWorkspace || this.workspaceRoot || sessionData?.workspacePath;
      if (!workspacePath) {
        return createInvalidParamsError('targetWorkspace is required (no workspace root configured)');
      }

      if (!fsSync.existsSync(workspacePath)) {
        return createError(ErrorType.NOT_FOUND, `Target workspace does not exist: ${workspacePath}`);
      }

      // 解析 sessionId 取得 ide
      const [ide] = sessionId.split(':');
      if (!ide) {
        return createInvalidParamsError('Invalid sessionId format');
      }

      // 建立匯出目錄: .edo_tensei/{ide}/{projectName}/
      const projectName = path.basename(workspacePath) || 'unknown_project';
      const exportDir = path.join(workspacePath, '.edo_tensei', ide, projectName);

      // 確保目錄存在
      await fs.mkdir(exportDir, { recursive: true });

      // 產生檔名: YYYYMMDD_HHMM_{title_or_id}.md
      const now = new Date();
      const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      const safeTitle = this.sanitizeFileName(sessionData?.title || sessionId.split(':')[1] || 'session');
      const fileName = `${timestamp}_${safeTitle}.md`;
      const filePath = path.join(exportDir, fileName);

      // 建立匯出內容
      const content = this.buildExportMarkdown(sessionData || { ide, capturedAt: now.toISOString(), messages: [] });

      // 寫入檔案
      await fs.writeFile(filePath, content, 'utf-8');

      Logger.info(`Exported session to: ${filePath}`);

      return createSuccess({
        success: true,
        exportPath: filePath,
        fileName
      });
    } catch (error) {
      Logger.logError('exportSession', error);
      return createError(ErrorType.INTERNAL_ERROR, `Failed to export session: ${error}`);
    }
  }

  // Helper methods

  private formatMessages(messages: Array<{ role: string; content: string; thought?: string }>, language: string): string {
    const roleLabels: Record<string, Record<string, string>> = {
      English: { user: 'User', assistant: 'Assistant', system: 'System', tool: 'Tool' },
      'Traditional Chinese': { user: '使用者', assistant: '助理', system: '系統', tool: '工具' },
      'Simplified Chinese': { user: '用户', assistant: '助手', system: '系统', tool: '工具' },
      Japanese: { user: 'ユーザー', assistant: 'アシスタント', system: 'システム', tool: 'ツール' },
      Korean: { user: '사용자', assistant: '어시스턴트', system: '시스템', tool: '도구' },
    };

    const labels = roleLabels[language] || roleLabels.English;

    return messages.map((msg, index) => {
      const role = labels[msg.role] || msg.role;
      let result = `[${index + 1}] **${role}**:\n${msg.content}`;
      if (msg.thought) {
        result += `\n\n💭 *Thinking*: ${msg.thought}`;
      }
      return result;
    }).join('\n\n---\n\n');
  }

  private sanitizeFileName(input: string): string {
    return input
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'session';
  }

  private buildExportMarkdown(sessionData: {
    ide: string;
    title?: string;
    workspacePath?: string;
    capturedAt: string;
    messages: Array<{ role: string; content: string; thought?: string; timestamp?: string }>;
  }): string {
    const lines: string[] = [];

    // 標題
    lines.push(`# Session Export: ${sessionData.title || 'Untitled'}`);
    lines.push('');

    // 中繼資料
    lines.push('## Metadata');
    lines.push('');
    lines.push(`- **Source IDE**: ${sessionData.ide}`);
    lines.push(`- **Captured At**: ${sessionData.capturedAt}`);
    if (sessionData.workspacePath) {
      lines.push(`- **Workspace**: ${sessionData.workspacePath}`);
    }
    lines.push('');

    // 對話內容
    lines.push('## Conversation');
    lines.push('');

    for (const msg of sessionData.messages) {
      const roleEmoji = msg.role === 'user' ? '👤' : msg.role === 'assistant' ? '🤖' : msg.role === 'system' ? '⚙️' : '🛠️';
      lines.push(`### ${roleEmoji} ${msg.role.charAt(0).toUpperCase() + msg.role.slice(1)}`);
      if (msg.timestamp) {
        lines.push(`*${msg.timestamp}*`);
      }
      lines.push('');
      lines.push(msg.content);
      if (msg.thought) {
        lines.push('');
        lines.push(`> 💭 *Thinking*: ${msg.thought}`);
      }
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    // 頁尾
    lines.push('');
    lines.push(`_Exported by Edo Tensei MCP Server_`);
    lines.push(`_Generated: ${new Date().toISOString()}_`);

    return lines.join('\n');
  }
}
