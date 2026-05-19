//! Scans VS Code Copilot Chat sessions.
//!
//! Paths:
//!   Windows:  %APPDATA%/Code/User/globalStorage/emptyWindowChatSessions/
//!   Linux:    ~/.config/Code/User/globalStorage/emptyWindowChatSessions/
//!   macOS:    ~/Library/Application Support/Code/User/globalStorage/emptyWindowChatSessions/
//!   Also:     {vscode-data}/User/workspaceStorage/{hash}/chatSessions/
//!
//! File formats:
//!   .json  — old format, single session with requests[]
//!   .jsonl — two variants: full snapshot (kind=0) or patch-based (kind=0 empty + kind=2 patches)

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};

use rayon::prelude::*;
use serde_json::Value;

use crate::types::{CapturedSession, ChatMessage};

use super::{file_metadata, home_dir, mtime_to_iso, read_dir_names};

pub fn extract_all(workspace: Option<&str>, custom_paths: &[String], full: bool) -> Vec<CapturedSession> {
    let vscode_user_dirs = get_vscode_user_dirs();

    let mut sessions: Vec<CapturedSession> = Vec::new();

    // Scan emptyWindowChatSessions + custom paths
    let empty_window_dirs: Vec<PathBuf> = vscode_user_dirs
        .iter()
        .map(|d| d.join("globalStorage").join("emptyWindowChatSessions"))
        .collect();

    let scan_dirs: Vec<&Path> = custom_paths
        .iter()
        .map(|p| Path::new(p.as_str()))
        .chain(empty_window_dirs.iter().map(|p| p.as_path()))
        .collect();

    for dir in scan_dirs {
        sessions.extend(extract_from_dir(dir, None, full));
    }

    // Scan workspaceStorage for workspace-specific sessions
    for vscode_dir in &vscode_user_dirs {
        let ws_storage = vscode_dir.join("workspaceStorage");
        sessions.extend(scan_workspace_storage(&ws_storage, workspace, full));
    }

    sessions.sort_unstable_by(|a, b| b.captured_at.cmp(&a.captured_at));
    sessions
}

fn get_vscode_user_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    #[cfg(target_os = "windows")]
    if let Ok(appdata) = std::env::var("APPDATA") {
        dirs.push(PathBuf::from(appdata).join("Code").join("User"));
    }

    #[cfg(target_os = "macos")]
    if let Some(home) = home_dir() {
        dirs.push(home.join("Library").join("Application Support").join("Code").join("User"));
    }

    #[cfg(target_os = "linux")]
    if let Some(home) = home_dir() {
        dirs.push(home.join(".config").join("Code").join("User"));
        dirs.push(home.join(".vscode-server").join("data").join("User"));
        dirs.push(home.join(".vscode-server-insiders").join("data").join("User"));
    }

    // Honor APPDATA on non-Windows too (e.g., test fixtures)
    #[cfg(not(target_os = "windows"))]
    if let Ok(appdata) = std::env::var("APPDATA") {
        dirs.push(PathBuf::from(appdata).join("Code").join("User"));
    }

    dirs
}

fn scan_workspace_storage(ws_storage: &Path, workspace: Option<&str>, full: bool) -> Vec<CapturedSession> {
    if !ws_storage.is_dir() {
        return vec![];
    }

    read_dir_names(ws_storage)
        .into_par_iter()
        .flat_map_iter(|entry| {
            let entry_dir = ws_storage.join(&entry);
            let ws_json_path = entry_dir.join("workspace.json");

            let resolved_ws = read_workspace_json_path(&ws_json_path);

            // Filter by workspace if provided
            if let Some(filter_ws) = workspace {
                match &resolved_ws {
                    Some(rws) if workspace_matches(rws, filter_ws) => {}
                    Some(_) => return vec![],
                    None => return vec![],
                }
            }

            let chat_dir = entry_dir.join("chatSessions");
            extract_from_dir(&chat_dir, resolved_ws.as_deref(), full)
        })
        .collect()
}

fn read_workspace_json_path(ws_json: &Path) -> Option<String> {
    let content = std::fs::read_to_string(ws_json).ok()?;
    // Strip BOM if present
    let content = content.trim_start_matches('\u{feff}');
    let obj: Value = serde_json::from_str(content).ok()?;
    let uri = obj.get("folder").or_else(|| obj.get("workspace"))?.as_str()?;
    // Decode file:///path/to/workspace → /path/to/workspace
    let decoded = uri
        .replace("file:///", "/")
        .replace("file://", "")
        .replace("%20", " ")
        .replace("%3A", ":");
    // Normalize Windows-style paths from URI (file:///C:/...)
    #[cfg(target_os = "windows")]
    let decoded = if decoded.starts_with('/') { decoded[1..].to_string() } else { decoded };
    Some(decoded)
}

fn workspace_matches(resolved: &str, filter: &str) -> bool {
    let r = resolved.replace('\\', "/").to_lowercase();
    let f = filter.replace('\\', "/").to_lowercase();
    r.contains(&f) || f.contains(&r)
}

fn extract_from_dir(dir: &Path, ws_path: Option<&str>, full: bool) -> Vec<CapturedSession> {
    if !dir.is_dir() {
        return vec![];
    }

    read_dir_names(dir)
        .into_par_iter()
        .filter(|name| name.ends_with(".json") || name.ends_with(".jsonl"))
        .filter_map(|name| {
            let file_path = dir.join(&name);
            let meta = file_metadata(&file_path)?;
            if meta.len() < 500 {
                return None;
            }

            let mtime_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            let raw_path = file_path.to_string_lossy().into_owned();
            let is_jsonl = name.ends_with(".jsonl");

            if full {
                let sessions = if is_jsonl {
                    parse_jsonl_full(&file_path)
                } else {
                    parse_json_full(&file_path)
                };
                Some(
                    sessions
                        .into_iter()
                        .map(|(session_id, title, messages)| CapturedSession {
                            source_ide: "copilot".into(),
                            captured_at: mtime_to_iso(mtime_ms),
                            session_id,
                            title,
                            workspace_path: ws_path.map(String::from),
                            messages,
                            messages_loaded: true,
                            file_size_bytes: Some(meta.len()),
                            raw_path: raw_path.clone(),
                            read_status: "success".into(),
                            error_detail: None,
                        })
                        .collect::<Vec<_>>(),
                )
            } else {
                let prescan = if is_jsonl {
                    prescan_jsonl(&file_path)
                } else {
                    prescan_json(&file_path)
                };
                Some(
                    prescan
                        .into_iter()
                        .filter(|(sid, _, msg)| sid.is_some() || msg.is_some())
                        .map(|(session_id, title, first_msg)| CapturedSession {
                            source_ide: "copilot".into(),
                            captured_at: mtime_to_iso(mtime_ms),
                            session_id,
                            title,
                            workspace_path: ws_path.map(String::from),
                            messages: first_msg.into_iter().collect(),
                            messages_loaded: false,
                            file_size_bytes: Some(meta.len()),
                            raw_path: raw_path.clone(),
                            read_status: "success".into(),
                            error_detail: None,
                        })
                        .collect::<Vec<_>>(),
                )
            }
        })
        .flatten()
        .collect()
}

// ── Prescan (metadata + first message only) ───────────────────────────────────

type PrescanEntry = (Option<String>, Option<String>, Option<ChatMessage>);

fn prescan_json(path: &Path) -> Vec<PrescanEntry> {
    let Ok(mut file) = std::fs::File::open(path) else { return vec![] };
    let mut buf = vec![0u8; 65536];
    let n = file.read(&mut buf).unwrap_or(0);
    let chunk = String::from_utf8_lossy(&buf[..n]);

    let session_id = extract_json_str_field(&chunk, "sessionId");
    let title = extract_json_str_field(&chunk, "customTitle");
    let first_text = extract_json_str_field(&chunk, "text").map(|t| t.chars().take(300).collect::<String>());
    let first_msg = first_text
        .filter(|t| !t.trim().is_empty())
        .map(|t| ChatMessage { role: "user".into(), content: t, ..Default::default() });

    vec![(session_id, title, first_msg)]
}

fn prescan_jsonl(path: &Path) -> Vec<PrescanEntry> {
    let Ok(file) = std::fs::File::open(path) else { return vec![] };
    let reader = BufReader::with_capacity(65536, file);

    let mut found: HashMap<String, PrescanEntry> = HashMap::new();
    // New format accumulation
    let mut new_format_id: Option<String> = None;
    let mut new_format_title: Option<String> = None;
    let mut new_format_first_msg: Option<ChatMessage> = None;
    let mut is_new_format = false;

    for line in reader.lines().map_while(Result::ok) {
        if !line.contains("\"requests\"") {
            continue;
        }
        let Ok(obj) = serde_json::from_str::<Value>(&line) else {
            // Fallback: regex-style extraction
            let session_id = extract_json_str_field(&line, "sessionId");
            if let Some(sid) = session_id {
                if !found.contains_key(&sid) {
                    let title = extract_json_str_field(&line, "customTitle");
                    let text = extract_json_str_field(&line, "text")
                        .map(|t| t.chars().take(300).collect::<String>());
                    let msg = text.filter(|t| !t.trim().is_empty()).map(|t| {
                        ChatMessage { role: "user".into(), content: t, ..Default::default() }
                    });
                    found.insert(sid.clone(), (Some(sid), title, msg));
                }
            }
            continue;
        };

        let kind = obj.get("kind").and_then(|v| v.as_i64());

        if kind == Some(0) {
            if let Some(v) = obj.get("v") {
                let sid = v.get("sessionId").and_then(|v| v.as_str()).map(String::from);
                let title = v.get("customTitle").and_then(|v| v.as_str()).map(String::from);
                let requests = v.get("requests").and_then(|v| v.as_array());
                match requests {
                    Some(reqs) if reqs.is_empty() => {
                        // New format
                        new_format_id = sid;
                        new_format_title = title;
                        is_new_format = true;
                    }
                    Some(reqs) if !reqs.is_empty() => {
                        // Old format: data is right here
                        if let Some(sid) = sid {
                            if !found.contains_key(&sid) {
                                let text = reqs[0]
                                    .get("message")
                                    .and_then(|m| m.get("text"))
                                    .and_then(|t| t.as_str())
                                    .map(|t| t.chars().take(300).collect::<String>());
                                let msg = text.filter(|t| !t.trim().is_empty()).map(|t| {
                                    ChatMessage { role: "user".into(), content: t, ..Default::default() }
                                });
                                found.insert(sid.clone(), (Some(sid), title, msg));
                            }
                        }
                    }
                    _ => {}
                }
            }
        } else if kind == Some(2) {
            let k = obj.get("k");
            let k_is_requests = k.map_or(false, |k| {
                k.as_str() == Some("requests")
                    || (k.as_array().map_or(false, |a| {
                        a.len() == 1 && a[0].as_str() == Some("requests")
                    }))
            });

            if k_is_requests && is_new_format && new_format_first_msg.is_none() {
                if let Some(reqs) = obj.get("v").and_then(|v| v.as_array()) {
                    if let Some(first) = reqs.first() {
                        let text = first
                            .get("message")
                            .and_then(|m| m.get("text"))
                            .and_then(|t| t.as_str())
                            .map(|t| t.chars().take(300).collect::<String>());
                        new_format_first_msg = text.filter(|t| !t.trim().is_empty()).map(|t| {
                            ChatMessage { role: "user".into(), content: t, ..Default::default() }
                        });
                    }
                }
                if new_format_id.is_some() && new_format_first_msg.is_some() {
                    break;
                }
            }
        }
    }

    if is_new_format {
        if let Some(sid) = new_format_id {
            if new_format_first_msg.is_some() {
                found.insert(sid.clone(), (Some(sid), new_format_title, new_format_first_msg));
            }
        }
    }

    found.into_values().collect()
}

// ── Full parse ────────────────────────────────────────────────────────────────

type FullEntry = (Option<String>, Option<String>, Vec<ChatMessage>);

fn parse_json_full(path: &Path) -> Vec<FullEntry> {
    let Ok(content) = std::fs::read_to_string(path) else { return vec![] };
    let content = content.trim_start_matches('\u{feff}');
    let Ok(obj) = serde_json::from_str::<Value>(content) else { return vec![] };

    let session_id = obj.get("sessionId").and_then(|v| v.as_str()).map(String::from);
    let title = obj.get("customTitle").and_then(|v| v.as_str()).map(String::from);
    let empty = vec![];
    let messages = parse_requests(obj.get("requests").and_then(|v| v.as_array()).unwrap_or(&empty));
    if messages.is_empty() {
        return vec![];
    }
    vec![(session_id, title, messages)]
}

fn parse_jsonl_full(path: &Path) -> Vec<FullEntry> {
    let Ok(file) = std::fs::File::open(path) else { return vec![] };
    let reader = BufReader::with_capacity(65536, file);

    // Accumulate state for new format
    let mut new_format_requests: Vec<Value> = Vec::new();
    let mut response_patches: HashMap<usize, Vec<Value>> = HashMap::new();
    let mut new_format_id: Option<String> = None;
    let mut new_format_title: Option<String> = None;
    let mut is_new_format = false;

    // Old format: last best snapshot per sessionId
    let mut old_format_sessions: HashMap<String, (Option<String>, Vec<Value>)> = HashMap::new();

    for line in reader.lines().map_while(Result::ok) {
        let trimmed = line.trim().to_string();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(obj) = serde_json::from_str::<Value>(&trimmed) else { continue };

        let kind = obj.get("kind").and_then(|v| v.as_i64());

        if kind == Some(0) {
            if let Some(v) = obj.get("v") {
                let sid = v.get("sessionId").and_then(|s| s.as_str()).map(String::from);
                let title = v.get("customTitle").and_then(|s| s.as_str()).map(String::from);
                let requests = v.get("requests").and_then(|r| r.as_array());
                match requests {
                    Some(reqs) if reqs.is_empty() => {
                        new_format_id = sid;
                        new_format_title = title;
                        is_new_format = true;
                    }
                    Some(reqs) => {
                        if let Some(sid) = sid {
                            old_format_sessions.insert(sid, (title, reqs.clone()));
                        }
                    }
                    None => {}
                }
            }
        } else if kind == Some(2) {
            let k = obj.get("k");
            let k_is_top_requests = k.map_or(false, |k| {
                k.as_str() == Some("requests")
                    || (k.as_array()
                        .map_or(false, |a| a.len() == 1 && a[0].as_str() == Some("requests")))
            });

            if k_is_top_requests {
                if let Some(items) = obj.get("v").and_then(|v| v.as_array()) {
                    new_format_requests.extend(items.iter().cloned());
                }
                continue;
            }

            // Response patch: k=["requests", N, "response"]
            if let Some(arr) = k.and_then(|k| k.as_array()) {
                if arr.len() == 3
                    && arr[0].as_str() == Some("requests")
                    && arr[2].as_str() == Some("response")
                {
                    if let Some(idx) = arr[1].as_u64() {
                        if let Some(parts) = obj.get("v").and_then(|v| v.as_array()) {
                            response_patches.insert(idx as usize, parts.clone());
                        }
                    }
                }
            }
        }
    }

    if is_new_format {
        // Apply response patches
        for (idx, resp) in &response_patches {
            if let Some(req) = new_format_requests.get_mut(*idx) {
                if let Some(map) = req.as_object_mut() {
                    map.insert("response".to_string(), Value::Array(resp.clone()));
                }
            }
        }
        let messages = parse_requests(&new_format_requests);
        if !messages.is_empty() {
            return vec![(new_format_id, new_format_title, messages)];
        }
        return vec![];
    }

    old_format_sessions
        .into_values()
        .filter_map(|(title, requests)| {
            let messages = parse_requests(&requests);
            if messages.is_empty() {
                None
            } else {
                Some((None, title, messages))
            }
        })
        .collect()
}

fn parse_requests(requests: &[Value]) -> Vec<ChatMessage> {
    let mut messages = Vec::new();
    for req in requests {
        let user_text = req.get("message").and_then(|m| m.get("text")).and_then(|t| t.as_str()).unwrap_or("").trim().to_string();
        if !user_text.is_empty() {
            let ts = req.get("timestamp").and_then(|t| t.as_u64()).map(|ms| {
                super::mtime_to_iso(ms)
            });
            messages.push(ChatMessage { role: "user".into(), content: user_text, timestamp: ts, thought: None });
        }

        if let Some(response) = req.get("response").and_then(|r| r.as_array()) {
            let assistant_text: String = response
                .iter()
                .filter(|p| p.get("kind").is_none())
                .filter_map(|p| p.get("value")?.as_str())
                .collect::<Vec<_>>()
                .join("");
            let trimmed = assistant_text.trim().to_string();
            if !trimmed.is_empty() {
                messages.push(ChatMessage { role: "assistant".into(), content: trimmed, thought: None, timestamp: None });
            }
        }
    }
    messages
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn extract_json_str_field(text: &str, field: &str) -> Option<String> {
    let pattern = format!("\"{field}\"");
    let start = text.find(&pattern)? + pattern.len();
    let rest = text[start..].trim_start();
    let rest = rest.strip_prefix(':')?.trim_start();
    let rest = rest.strip_prefix('"')?;
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}
