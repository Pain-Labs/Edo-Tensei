//! Scans ~/.cursor/projects/{slug}/agent-transcripts/{uuid}/{uuid}.jsonl
//!
//! Each line: {"role":"user"|"assistant","message":{"content":[{"type":"text","text":"..."}]}}

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use rayon::prelude::*;
use serde_json::Value;

use crate::types::{CapturedSession, ChatMessage};

use super::{file_metadata, home_dir, mtime_to_iso, read_dir_names};

pub fn extract_all(workspace: Option<&str>, custom_paths: &[String], full: bool) -> Vec<CapturedSession> {
    let mut scan_dirs: Vec<PathBuf> = custom_paths.iter().map(PathBuf::from).collect();
    if let Some(home) = home_dir() {
        scan_dirs.push(home.join(".cursor").join("projects"));
    }

    let mut sessions: Vec<CapturedSession> = scan_dirs
        .iter()
        .flat_map(|projects_dir| scan_projects_dir(projects_dir, workspace, full))
        .collect();

    sessions.sort_unstable_by(|a, b| b.captured_at.cmp(&a.captured_at));
    sessions
}

fn scan_projects_dir(projects_dir: &Path, _workspace: Option<&str>, full: bool) -> Vec<CapturedSession> {
    if !projects_dir.is_dir() {
        return vec![];
    }

    read_dir_names(projects_dir)
        .into_par_iter()
        .flat_map_iter(|slug| {
            let project_path = projects_dir.join(&slug);
            if !project_path.is_dir() {
                return vec![];
            }
            scan_project_transcripts(&project_path, full)
        })
        .collect()
}

fn scan_project_transcripts(project_path: &Path, full: bool) -> Vec<CapturedSession> {
    let transcripts_dir = project_path.join("agent-transcripts");
    if !transcripts_dir.is_dir() {
        return vec![];
    }

    read_dir_names(&transcripts_dir)
        .into_par_iter()
        .filter_map(|uuid_dir| {
            let jsonl_path = transcripts_dir.join(&uuid_dir).join(format!("{uuid_dir}.jsonl"));
            let meta = file_metadata(&jsonl_path)?;
            if meta.len() < 100 {
                return None;
            }

            let mtime_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            let raw_path = jsonl_path.to_string_lossy().into_owned();
            let workspace_path = Some(project_path.to_string_lossy().into_owned());

            if full {
                let messages = parse_jsonl_full(&jsonl_path);
                if messages.is_empty() {
                    return None;
                }
                Some(CapturedSession {
                    source_ide: "cursor".into(),
                    captured_at: mtime_to_iso(mtime_ms),
                    session_id: Some(uuid_dir),
                    workspace_path,
                    messages,
                    messages_loaded: true,
                    file_size_bytes: Some(meta.len()),
                    raw_path,
                    read_status: "success".into(),
                    title: None,
                    error_detail: None,
                })
            } else {
                let first_msg = prescan_first_user_message(&jsonl_path);
                Some(CapturedSession {
                    source_ide: "cursor".into(),
                    captured_at: mtime_to_iso(mtime_ms),
                    session_id: Some(uuid_dir),
                    workspace_path,
                    messages: first_msg.into_iter().collect(),
                    messages_loaded: false,
                    file_size_bytes: Some(meta.len()),
                    raw_path,
                    read_status: "success".into(),
                    title: None,
                    error_detail: None,
                })
            }
        })
        .collect()
}

fn prescan_first_user_message(path: &Path) -> Option<ChatMessage> {
    let file = std::fs::File::open(path).ok()?;
    let reader = BufReader::with_capacity(65536, file);

    for line in reader.lines().map_while(Result::ok) {
        let trimmed = line.trim().to_string();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(obj) = serde_json::from_str::<Value>(&trimmed) else { continue };
        if obj.get("role").and_then(|v| v.as_str()) != Some("user") {
            continue;
        }
        if let Some(msg) = extract_message(&obj) {
            return Some(msg);
        }
    }
    None
}

fn parse_jsonl_full(path: &Path) -> Vec<ChatMessage> {
    let Ok(file) = std::fs::File::open(path) else { return vec![] };
    let reader = BufReader::with_capacity(65536, file);
    let mut messages = Vec::new();

    for line in reader.lines().map_while(Result::ok) {
        let trimmed = line.trim().to_string();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(obj) = serde_json::from_str::<Value>(&trimmed) else { continue };
        let role = obj.get("role").and_then(|v| v.as_str()).unwrap_or("");
        if role != "user" && role != "assistant" {
            continue;
        }
        if let Some(msg) = extract_message(&obj) {
            messages.push(msg);
        }
    }
    messages
}

fn extract_message(obj: &Value) -> Option<ChatMessage> {
    let role = obj.get("role")?.as_str()?.to_string();
    let content_arr = obj.get("message")?.get("content")?.as_array()?;

    let text: String = content_arr
        .iter()
        .filter(|c| c.get("type").and_then(|v| v.as_str()) == Some("text"))
        .filter_map(|c| c.get("text")?.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return None;
    }

    Some(ChatMessage { role, content: trimmed, thought: None, timestamp: None })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_extract_user_message() {
        let obj = json!({
            "role": "user",
            "message": {
                "content": [{"type": "text", "text": "What is Rust?"}]
            }
        });
        let msg = extract_message(&obj).unwrap();
        assert_eq!(msg.role, "user");
        assert_eq!(msg.content, "What is Rust?");
    }

    #[test]
    fn test_extract_assistant_message() {
        let obj = json!({
            "role": "assistant",
            "message": {
                "content": [
                    {"type": "text", "text": "Rust is a "},
                    {"type": "text", "text": "systems language."}
                ]
            }
        });
        let msg = extract_message(&obj).unwrap();
        assert_eq!(msg.role, "assistant");
        assert_eq!(msg.content, "Rust is a \nsystems language.");
    }

    #[test]
    fn test_skip_non_text_content_types() {
        let obj = json!({
            "role": "user",
            "message": {
                "content": [
                    {"type": "image", "url": "http://example.com/img.png"},
                    {"type": "text", "text": "What's in this image?"}
                ]
            }
        });
        let msg = extract_message(&obj).unwrap();
        assert_eq!(msg.content, "What's in this image?");
    }

    #[test]
    fn test_empty_content_returns_none() {
        let obj = json!({
            "role": "user",
            "message": {"content": [{"type": "text", "text": "   "}]}
        });
        assert!(extract_message(&obj).is_none());
    }

    #[test]
    fn test_unknown_role_passthrough() {
        let obj = json!({
            "role": "tool",
            "message": {"content": [{"type": "text", "text": "output"}]}
        });
        let msg = extract_message(&obj).unwrap();
        assert_eq!(msg.role, "tool");
    }
}
