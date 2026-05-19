use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thought: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedSession {
    pub source_ide: String,
    pub captured_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
    pub messages: Vec<ChatMessage>,
    pub messages_loaded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size_bytes: Option<u64>,
    pub raw_path: String,
    pub read_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_detail: Option<String>,
}
