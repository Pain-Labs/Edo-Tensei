//! Scans Kiro session files.
//!
//! Format A (legacy .chat): {kiro-agent-dir}/{hex32}/*.chat
//!   JSON: { "chat": [{ "role": "user"|"bot", "content": "..." }] }
//!
//! Format B (workspace-sessions): {kiro-agent-dir}/workspace-sessions/{base64url}/{uuid}.json
//!   JSON: { "workspaceDirectory": "...", "history": [{ "message": { "role": "...", "content": [...] | "string" } }] }

use std::path::{Path, PathBuf};

use rayon::prelude::*;
use serde_json::Value;

use crate::types::{CapturedSession, ChatMessage};

use super::{file_metadata, home_dir, mtime_to_iso, read_dir_names};

pub fn extract_all(workspace: Option<&str>, custom_paths: &[String], full: bool) -> Vec<CapturedSession> {
    let mut scan_dirs: Vec<PathBuf> = custom_paths.iter().map(PathBuf::from).collect();
    scan_dirs.extend(get_kiro_agent_dirs());

    let mut sessions: Vec<CapturedSession> = scan_dirs
        .iter()
        .flat_map(|root| {
            let mut s = Vec::new();
            s.extend(extract_workspace_sessions(root, workspace, full));
            s.extend(extract_legacy_chat_files(root, workspace, full));
            s
        })
        .collect();

    sessions.sort_unstable_by(|a, b| b.captured_at.cmp(&a.captured_at));
    sessions
}

fn get_kiro_agent_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = home_dir() {
        #[cfg(target_os = "windows")]
        {
            if let Ok(appdata) = std::env::var("APPDATA") {
                dirs.push(
                    PathBuf::from(appdata)
                        .join("Kiro")
                        .join("User")
                        .join("globalStorage")
                        .join("kiro.kiroagent"),
                );
            }
        }
        #[cfg(not(target_os = "windows"))]
        dirs.push(
            home.join(".config")
                .join("Kiro")
                .join("User")
                .join("globalStorage")
                .join("kiro.kiroagent"),
        );
    }
    dirs
}

// ── Format B: workspace-sessions ─────────────────────────────────────────────

fn extract_workspace_sessions(root: &Path, workspace: Option<&str>, full: bool) -> Vec<CapturedSession> {
    let ws_sessions_dir = root.join("workspace-sessions");
    if !ws_sessions_dir.is_dir() {
        return vec![];
    }

    read_dir_names(&ws_sessions_dir)
        .into_par_iter()
        .flat_map_iter(|encoded_name| {
            let folder = ws_sessions_dir.join(&encoded_name);
            if !folder.is_dir() {
                return vec![];
            }
            let fallback_path = decode_base64url_path(&encoded_name);

            read_dir_names(&folder)
                .into_iter()
                .filter(|f| f.ends_with(".json") && f != "sessions.json")
                .filter_map(|f| {
                    let file_path = folder.join(&f);
                    let meta = file_metadata(&file_path)?;
                    let mtime_ms = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);

                    let raw = std::fs::read_to_string(&file_path).ok()?;
                    let session_id = f.trim_end_matches(".json").to_string();

                    if full {
                        let (messages, ws_dir) = parse_ws_session_full(&raw);
                        let resolved_ws = ws_dir.or_else(|| fallback_path.clone());
                        if let Some(ref filter) = workspace {
                            if !resolved_ws.as_deref().map_or(false, |w| workspace_matches(w, filter)) {
                                return None;
                            }
                        }
                        if messages.is_empty() {
                            return None;
                        }
                        Some(CapturedSession {
                            source_ide: "kiro".into(),
                            captured_at: mtime_to_iso(mtime_ms),
                            session_id: Some(session_id),
                            workspace_path: resolved_ws,
                            messages,
                            messages_loaded: true,
                            file_size_bytes: Some(meta.len()),
                            raw_path: file_path.to_string_lossy().into_owned(),
                            read_status: "success".into(),
                            title: None,
                            error_detail: None,
                        })
                    } else {
                        let (first_msg, ws_dir) = parse_ws_session_lazy(&raw);
                        let resolved_ws = ws_dir.or_else(|| fallback_path.clone());
                        if let Some(ref filter) = workspace {
                            if !resolved_ws.as_deref().map_or(false, |w| workspace_matches(w, filter)) {
                                return None;
                            }
                        }
                        Some(CapturedSession {
                            source_ide: "kiro".into(),
                            captured_at: mtime_to_iso(mtime_ms),
                            session_id: Some(session_id),
                            workspace_path: resolved_ws,
                            messages: first_msg.into_iter().collect(),
                            messages_loaded: false,
                            file_size_bytes: Some(meta.len()),
                            raw_path: file_path.to_string_lossy().into_owned(),
                            read_status: "success".into(),
                            title: None,
                            error_detail: None,
                        })
                    }
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

fn parse_ws_session_lazy(raw: &str) -> (Option<ChatMessage>, Option<String>) {
    let Ok(obj) = serde_json::from_str::<Value>(raw) else { return (None, None) };
    let ws_dir = obj.get("workspaceDirectory").and_then(|v| v.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let history = obj.get("history").and_then(|v| v.as_array());
    let Some(history) = history else { return (None, ws_dir) };

    for entry in history {
        let msg = entry.get("message");
        let Some(msg) = msg else { continue };
        if msg.get("role").and_then(|v| v.as_str()) != Some("user") {
            continue;
        }
        if let Some(text) = extract_message_content(msg) {
            return (Some(ChatMessage { role: "user".into(), content: text, ..Default::default() }), ws_dir);
        }
    }
    (None, ws_dir)
}

fn parse_ws_session_full(raw: &str) -> (Vec<ChatMessage>, Option<String>) {
    let Ok(obj) = serde_json::from_str::<Value>(raw) else { return (vec![], None) };
    let ws_dir = obj.get("workspaceDirectory").and_then(|v| v.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let history = obj.get("history").and_then(|v| v.as_array());
    let Some(history) = history else { return (vec![], ws_dir) };

    let mut messages = Vec::new();
    for entry in history {
        let msg = entry.get("message");
        let Some(msg) = msg else { continue };
        let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("");
        if role.is_empty() {
            continue;
        }
        if let Some(text) = extract_message_content(msg) {
            let mapped_role = if role == "user" { "user" } else { "assistant" };
            messages.push(ChatMessage { role: mapped_role.into(), content: text, ..Default::default() });
        }
    }
    (messages, ws_dir)
}

fn extract_message_content(msg: &Value) -> Option<String> {
    let content = msg.get("content")?;
    let text = if let Some(s) = content.as_str() {
        s.trim().to_string()
    } else if let Some(arr) = content.as_array() {
        arr.iter()
            .filter(|p| p.get("type").and_then(|v| v.as_str()) == Some("text"))
            .filter_map(|p| p.get("text")?.as_str())
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_string()
    } else {
        return None;
    };
    if text.is_empty() { None } else { Some(text) }
}

// ── Format A: legacy .chat files ─────────────────────────────────────────────

fn extract_legacy_chat_files(root: &Path, workspace: Option<&str>, full: bool) -> Vec<CapturedSession> {
    if !root.is_dir() {
        return vec![];
    }

    read_dir_names(root)
        .into_par_iter()
        .filter(|name| is_hex_hash(name))
        .flat_map_iter(|folder_name| {
            let folder = root.join(&folder_name);
            if !folder.is_dir() {
                return vec![];
            }

            // Workspace filter for legacy format is best-effort (no workspacePath stored)
            // Skip if workspace filter given — we can't match without metadata
            if workspace.is_some() {
                return vec![];
            }

            read_dir_names(&folder)
                .into_iter()
                .filter(|f| f.ends_with(".chat"))
                .filter_map(|f| {
                    let file_path = folder.join(&f);
                    let meta = file_metadata(&file_path)?;
                    let mtime_ms = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);

                    let raw = std::fs::read_to_string(&file_path).ok()?;
                    let messages = parse_legacy_chat(&raw, full);
                    if messages.is_empty() {
                        return None;
                    }

                    let session_id = f.trim_end_matches(".chat").to_string();
                    Some(CapturedSession {
                        source_ide: "kiro".into(),
                        captured_at: mtime_to_iso(mtime_ms),
                        session_id: Some(session_id),
                        workspace_path: None,
                        messages,
                        messages_loaded: full,
                        file_size_bytes: Some(meta.len()),
                        raw_path: file_path.to_string_lossy().into_owned(),
                        read_status: "success".into(),
                        title: None,
                        error_detail: None,
                    })
                })
                .collect()
        })
        .collect()
}

fn parse_legacy_chat(raw: &str, full: bool) -> Vec<ChatMessage> {
    let Ok(obj) = serde_json::from_str::<Value>(raw) else { return vec![] };
    let chat_arr = obj.get("chat").and_then(|v| v.as_array());
    let Some(chat_arr) = chat_arr else { return vec![] };

    let mut messages = Vec::new();
    for msg in chat_arr {
        let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("");
        let content = msg.get("content").and_then(|v| v.as_str()).unwrap_or("").trim();

        if content.is_empty() || role == "tool" {
            continue;
        }

        let cleaned = sanitize_legacy_message(role, content);
        if cleaned.is_empty() {
            continue;
        }

        // Skip acknowledgement-only assistant messages
        if (role == "bot" || role == "assistant") && is_ack_only(&cleaned) {
            continue;
        }

        let mapped_role = match role {
            "human" | "user" => "user",
            _ => "assistant",
        };

        messages.push(ChatMessage { role: mapped_role.into(), content: cleaned, ..Default::default() });

        if !full && !messages.is_empty() {
            break; // Lazy: only first message needed
        }
    }
    messages
}

fn sanitize_legacy_message(role: &str, text: &str) -> String {
    let mut cleaned = text.to_string();
    if matches!(role, "human" | "user") {
        if cleaned.trim_start().starts_with("# System Prompt") || cleaned.trim_start().starts_with("<identity>") {
            return String::new();
        }
        // Strip leading injected blocks
        for tag in &["identity", "capabilities"] {
            let open = format!("<{tag}");
            let close = format!("</{tag}>");
            if let Some(start) = cleaned.find(&open) {
                if let Some(end_inner) = cleaned[start..].find(&close) {
                    let end = start + end_inner + close.len();
                    cleaned = cleaned[end..].trim_start().to_string();
                }
            }
        }
        // Strip trailing context tags
        if let Some(idx) = cleaned.find("<EnvironmentContext>") {
            cleaned = cleaned[..idx].trim_end().to_string();
        }
    }
    cleaned.trim().to_string()
}

fn is_ack_only(text: &str) -> bool {
    matches!(text.trim(), "I will follow these instructions." | "Understood." | "On it.")
}

// ── Utilities ─────────────────────────────────────────────────────────────────

fn decode_base64url_path(encoded: &str) -> Option<String> {
    use base64::engine::general_purpose::URL_SAFE;
    use base64::Engine as _;

    // Pad to multiple of 4
    let pad = (4 - encoded.len() % 4) % 4;
    let padded = format!("{encoded}{}", "=".repeat(pad));
    let decoded = URL_SAFE.decode(padded.as_bytes()).ok()?;
    let s = String::from_utf8(decoded).ok()?;
    // Strip trailing control chars / '?'
    let clean = s.split('\x0f').next().unwrap_or("").trim_end_matches('?').trim_end();
    if clean.is_empty() { None } else { Some(clean.to_string()) }
}

fn is_hex_hash(name: &str) -> bool {
    name.len() == 32 && name.chars().all(|c| c.is_ascii_hexdigit())
}

fn workspace_matches(resolved: &str, filter: &str) -> bool {
    let r = resolved.replace('\\', "/").to_lowercase();
    let f = filter.replace('\\', "/").to_lowercase();
    r.contains(&f) || f.contains(&r)
}
