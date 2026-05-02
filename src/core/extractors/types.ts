/**
 * Extracted chat message from any IDE
 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  thought?: string;
  toolCalls?: any[];
  timestamp?: string;
}

/**
 * A session extracted from a specific IDE's local storage.
 */
export interface CapturedSession {
  sourceIde: 'copilot' | 'cursor' | 'antigravity' | 'windsurf' | 'trae' | 'kiro' | 'claude' | 'codex';
  capturedAt: string; // ISO timestamp
  sessionId?: string;
  title?: string;
  workspacePath?: string;
  messages: ChatMessage[];
  messagesLoaded?: boolean; // If true, the session has been fully loaded (for lazy loading)
  fileSizeBytes?: number;   // Raw file size in bytes — used for token estimation without loading messages
  metadata?: Record<string, any>; // Extractor-specific metadata (e.g. executionIds)
  rawPath: string; // source file path (for debugging)
  readStatus: 'success' | 'empty' | 'encrypted' | 'not_found' | 'unknown_format' | 'error';
  errorDetail?: string;
}

/**
 * Common interface for all IDE extractors
 */
export interface IChatExtractor {
  readonly ideId: CapturedSession['sourceIde'];
  /** 嘗試從本地儲存讀取最新的 Chat Session。
   * @param workspacePath - 目前開啟的 workspace 資料夾路徑（部分 IDE 需要此資訊定位對應紀錄）
   * @param customScanPaths - 自訂掃描路徑清單
   */
  extract(workspacePath?: string, customScanPaths?: string[]): Promise<CapturedSession>;

  /** 抓取本地儲存中該 IDE 的所有歷史 Chat Sessions。
   * @param workspacePath - 用於過濾或排序的參考路徑
   * @param customScanPaths - 自訂掃描路徑清單
   */
  extractAll(workspacePath?: string, customScanPaths?: string[]): Promise<CapturedSession[]>;

  /** 
   * (Optional) 延遲載入完整對話內容。
   * 某些 IDE (如 Kiro) 的對話圖形十分龐大，Scan Project 時僅載入摘要，需要時才呼叫此方法展開。
   */
  loadFullMessages?(session: CapturedSession): Promise<void>;
}
