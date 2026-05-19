//! Scans ~/.codex/sessions/rollout-*.jsonl
//!
//! Record types:
//!   {"type":"session_meta","payload":{"cwd":"...","id":"..."}}
//!   {"type":"response_item","payload":{"type":"message","role":"user"|"assistant","content":[...]}}

use std::path::{Path, PathBuf};

use rayon::prelude::*;
use serde_json::Value;

use crate::types::{CapturedSession, ChatMessage};

use super::{file_metadata, home_dir, mtime_to_iso};

const INJECTED_PREFIXES: &[&str] = &[
    "<permissions instructions>",
    "<collaboration_mode>",
    "<skills_instructions>",
    "<environment_context>",
    "# AGENTS.md instructions for",
    "<turn_aborted>",
];

pub fn extract_all(workspace: Option<&str>, custom_paths: &[String], full: bool) -> Vec<CapturedSession> {
    let mut scan_dirs: Vec<PathBuf> = custom_paths.iter().map(PathBuf::from).collect();
    if let Some(home) = home_dir() {
        scan_dirs.push(home.join(".codex").join("sessions"));
    }

    let mut sessions: Vec<CapturedSession> = scan_dirs
        .iter()
        .flat_map(|dir| scan_sessions_dir(dir, workspace, full))
        .collect();

    sessions.sort_unstable_by(|a, b| b.captured_at.cmp(&a.captured_at));
    sessions
}

fn scan_sessions_dir(dir: &Path, workspace: Option<&str>, full: bool) -> Vec<CapturedSession> {
    if !dir.is_dir() {
        return vec![];
    }

    collect_rollout_files(dir)
        .into_par_iter()
        .filter_map(|file_path| process_rollout_file(&file_path, workspace, full))
        .collect()
}

fn collect_rollout_files(root: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
        if depth > 5 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, depth + 1, out);
            } else if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                let lower = name.to_lowercase();
                if lower.starts_with("rollout-") && lower.ends_with(".jsonl") {
                    out.push(path);
                }
            }
        }
    }

    let mut files = Vec::new();
    walk(root, 0, &mut files);
    files
}

fn process_rollout_file(path: &Path, workspace: Option<&str>, full: bool) -> Option<CapturedSession> {
    let meta = file_metadata(path)?;
    if meta.len() < 200 {
        return None;
    }

    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let raw = std::fs::read_to_string(path).ok()?;
    let parsed = parse_codex_rollout(&raw, full);

    if parsed.messages.is_empty() {
        return None;
    }

    // Workspace filter
    if let Some(ws) = workspace {
        let ws_norm = normalize_path(ws);
        if let Some(ref cwd) = parsed.cwd {
            if !normalize_path(cwd).contains(&ws_norm) {
                return None;
            }
        } else {
            return None;
        }
    }

    Some(CapturedSession {
        source_ide: "codex".into(),
        captured_at: mtime_to_iso(mtime_ms),
        session_id: parsed.session_id,
        title: parsed.title,
        workspace_path: parsed.cwd,
        messages: parsed.messages,
        messages_loaded: full,
        file_size_bytes: Some(meta.len()),
        raw_path: path.to_string_lossy().into_owned(),
        read_status: "success".into(),
        error_detail: None,
    })
}

struct ParsedRollout {
    messages: Vec<ChatMessage>,
    cwd: Option<String>,
    session_id: Option<String>,
    title: Option<String>,
}

fn parse_codex_rollout(raw: &str, _full: bool) -> ParsedRollout {
    let mut messages = Vec::new();
    let mut cwd: Option<String> = None;
    let mut session_id: Option<String> = None;

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(obj) = serde_json::from_str::<Value>(trimmed) else { continue };

        let record_type = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");

        if record_type == "session_meta" {
            if let Some(payload) = obj.get("payload") {
                if cwd.is_none() {
                    cwd = payload.get("cwd").and_then(|v| v.as_str()).map(String::from);
                }
                if session_id.is_none() {
                    session_id = payload.get("id").and_then(|v| v.as_str()).map(String::from);
                }
            }
            continue;
        }

        if record_type == "response_item" {
            if let Some(payload) = obj.get("payload") {
                if payload.get("type").and_then(|v| v.as_str()) != Some("message") {
                    continue;
                }
                let role = payload.get("role").and_then(|v| v.as_str()).unwrap_or("");
                if !matches!(role, "user" | "assistant" | "developer" | "system") {
                    continue;
                }

                let content_arr = match payload.get("content").and_then(|v| v.as_array()) {
                    Some(arr) => arr,
                    None => continue,
                };

                let text: String = content_arr
                    .iter()
                    .map(|c| {
                        c.get("text")
                            .or_else(|| c.get("input_text"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                    })
                    .collect::<Vec<_>>()
                    .join("");

                let text = text.trim();
                if text.is_empty() {
                    continue;
                }

                // Skip injected system messages
                if is_injected_message(role, text) {
                    continue;
                }

                // Handle IDE context wrapper
                if role == "user" && text.trim_start().starts_with("# Context from my IDE setup:") {
                    let marker = "## My request for Codex:";
                    if let Some(idx) = text.find(marker) {
                        let request_text = text[idx + marker.len()..].trim();
                        if !request_text.is_empty() {
                            messages.push(ChatMessage {
                                role: "user".into(),
                                content: request_text.to_string(),
                                timestamp: obj.get("timestamp").and_then(|v| v.as_str()).map(String::from),
                                thought: None,
                            });
                        }
                    }
                    continue;
                }

                let mapped_role = match role {
                    "user" => "user",
                    "assistant" => "assistant",
                    _ => "system",
                };

                messages.push(ChatMessage {
                    role: mapped_role.into(),
                    content: text.to_string(),
                    timestamp: obj.get("timestamp").and_then(|v| v.as_str()).map(String::from),
                    thought: None,
                });
            }
        }
    }

    ParsedRollout { messages, cwd, session_id, title: None }
}

fn is_injected_message(role: &str, text: &str) -> bool {
    if role == "developer" || role == "system" {
        return true;
    }
    let stripped = text.trim_start();
    if stripped.starts_with("<turn_aborted>") {
        return true;
    }
    INJECTED_PREFIXES.iter().any(|prefix| stripped.starts_with(prefix))
}

fn normalize_path(p: &str) -> String {
    p.replace('\\', "/").to_lowercase()
}
