//! Scans ~/.claude/projects/{slug}/*.jsonl
//!
//! Each JSONL line: {"type":"user"|"assistant","timestamp":"...","cwd":"...","message":{"content":[...]}}

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};

use rayon::prelude::*;
use serde_json::Value;

use crate::types::{CapturedSession, ChatMessage};

use super::{file_metadata, home_dir, mtime_to_iso, read_dir_names};

pub fn extract_all(workspace: Option<&str>, custom_paths: &[String], full: bool) -> Vec<CapturedSession> {
    let mut scan_dirs: Vec<PathBuf> = custom_paths.iter().map(PathBuf::from).collect();
    if let Some(home) = home_dir() {
        scan_dirs.push(home.join(".claude").join("projects"));
    }

    let mut sessions: Vec<CapturedSession> = scan_dirs
        .iter()
        .flat_map(|projects_dir| scan_projects_dir(projects_dir, workspace, full))
        .collect();

    sessions.sort_unstable_by(|a, b| b.captured_at.cmp(&a.captured_at));
    sessions
}

fn scan_projects_dir(projects_dir: &Path, workspace: Option<&str>, full: bool) -> Vec<CapturedSession> {
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
            if let Some(ws) = workspace {
                if !slug_matches_workspace(&slug, ws) {
                    return vec![];
                }
            }
            scan_project_dir(&project_path, &slug, full)
        })
        .collect()
}

fn scan_project_dir(project_path: &Path, slug: &str, full: bool) -> Vec<CapturedSession> {
    read_dir_names(project_path)
        .into_iter()
        .filter(|name| name.ends_with(".jsonl"))
        .filter_map(|name| {
            let file_path = project_path.join(&name);
            let meta = file_metadata(&file_path)?;
            if meta.len() < 200 {
                return None;
            }
            let mtime_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            let session_id = name.trim_end_matches(".jsonl").to_string();
            let raw_path = file_path.to_string_lossy().into_owned();

            if full {
                let (messages, cwd) = parse_jsonl_full(&file_path);
                if messages.is_empty() {
                    return None;
                }
                Some(CapturedSession {
                    source_ide: "claude".into(),
                    captured_at: mtime_to_iso(mtime_ms),
                    session_id: Some(session_id),
                    workspace_path: cwd.or_else(|| slug_to_workspace_path(slug)),
                    messages,
                    messages_loaded: true,
                    file_size_bytes: Some(meta.len()),
                    raw_path,
                    read_status: "success".into(),
                    title: None,
                    error_detail: None,
                })
            } else {
                let (first_msg, cwd) = prescan_first_user_message(&file_path);
                Some(CapturedSession {
                    source_ide: "claude".into(),
                    captured_at: mtime_to_iso(mtime_ms),
                    session_id: Some(session_id),
                    workspace_path: cwd.or_else(|| slug_to_workspace_path(slug)),
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

/// Read first 16 KB, extract cwd + first user message.
fn prescan_first_user_message(path: &Path) -> (Option<ChatMessage>, Option<String>) {
    let Ok(file) = std::fs::File::open(path) else { return (None, None) };
    let mut buf = vec![0u8; 16384];
    let mut reader = BufReader::new(file);
    let n = reader.read(&mut buf).unwrap_or(0);
    let chunk = String::from_utf8_lossy(&buf[..n]);

    let mut cwd: Option<String> = None;
    let mut first_msg: Option<ChatMessage> = None;

    for line in chunk.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(obj) = serde_json::from_str::<Value>(trimmed) else { continue };

        if cwd.is_none() {
            if let Some(c) = obj.get("cwd").and_then(|v| v.as_str()) {
                cwd = Some(c.to_string());
            }
        }

        if first_msg.is_none() {
            let msg_type = obj.get("type").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
            if msg_type == "user" {
                if let Some(msg) = extract_message_from_record(&obj) {
                    first_msg = Some(msg);
                }
            }
        }

        if cwd.is_some() && first_msg.is_some() {
            break;
        }
    }

    (first_msg, cwd)
}

fn parse_jsonl_full(path: &Path) -> (Vec<ChatMessage>, Option<String>) {
    let Ok(file) = std::fs::File::open(path) else { return (vec![], None) };
    let reader = BufReader::new(file);
    let mut messages = Vec::new();
    let mut cwd: Option<String> = None;

    for line in reader.lines().map_while(Result::ok) {
        let trimmed = line.trim().to_string();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(obj) = serde_json::from_str::<Value>(&trimmed) else { continue };

        if cwd.is_none() {
            if let Some(c) = obj.get("cwd").and_then(|v| v.as_str()) {
                cwd = Some(c.to_string());
            }
        }

        if let Some(msg) = extract_message_from_record(&obj) {
            messages.push(msg);
        }
    }

    (messages, cwd)
}

fn extract_message_from_record(obj: &Value) -> Option<ChatMessage> {
    let msg_type = obj.get("type")?.as_str()?.to_lowercase();
    if msg_type != "user" && msg_type != "assistant" {
        return None;
    }
    let role = msg_type;
    let content_arr = obj.get("message")?.get("content")?.as_array()?;

    let mut text_parts: Vec<String> = Vec::new();
    for item in content_arr {
        let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
        // Skip tool_result items
        if item_type == "tool_result" {
            continue;
        }
        if item_type == "thinking" {
            if let Some(t) = item.get("thinking").and_then(|v| v.as_str()) {
                let t = t.trim();
                if !t.is_empty() {
                    text_parts.push(t.to_string());
                }
            }
        } else if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
            let stripped = text.replace(['<', '>'], "").trim().to_string();
            if !stripped.is_empty() {
                text_parts.push(stripped);
            }
        }
    }

    let content = text_parts.join("\n").trim().to_string();
    if content.is_empty() {
        return None;
    }

    Some(ChatMessage {
        role,
        content,
        timestamp: obj.get("timestamp").and_then(|v| v.as_str()).map(String::from),
        thought: None,
    })
}

fn slug_matches_workspace(slug: &str, workspace: &str) -> bool {
    let slug_lower = slug.to_lowercase();
    let ws_norm = workspace
        .replace('\\', "-")
        .replace('/', "-")
        .replace(':', "-")
        .to_lowercase();
    slug_lower.contains(&ws_norm) || ws_norm.contains(&slug_lower)
}

fn slug_to_workspace_path(slug: &str) -> Option<String> {
    // Windows: c--Users-username-Project → C:\Users\username\Project
    if let Some(caps) = slug.splitn(3, '-').collect::<Vec<_>>().first().copied() {
        if caps.len() == 1 && slug.starts_with(&format!("{caps}--")) {
            let drive = caps.to_uppercase();
            let rest = slug[caps.len() + 2..].replace('-', std::path::MAIN_SEPARATOR_STR);
            return Some(format!("{drive}:{}{rest}", std::path::MAIN_SEPARATOR));
        }
    }
    // Unix: -home-user-project → /home/user/project
    if slug.starts_with('-') {
        return Some(format!("/{}", &slug[1..].replace('-', "/")));
    }
    None
}
