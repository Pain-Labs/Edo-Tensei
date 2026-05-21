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
];

/// Known open/close block pairs that make up Codex injected scaffolding.
const INJECTED_BLOCKS: &[(&str, &str)] = &[
    ("<permissions instructions>", "</permissions instructions>"),
    ("<collaboration_mode>", "</collaboration_mode>"),
    ("<skills_instructions>", "</skills_instructions>"),
    ("<environment_context>", "</environment_context>"),
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

/// Literal-string block removal (mirrors TypeScript `removeMarkedBlocks`).
fn remove_marked_blocks(text: &str, open: &str, close: &str) -> String {
    let mut result = String::new();
    let mut cursor = 0;
    let lower = text.to_lowercase();
    let lo = open.to_lowercase();
    let lc = close.to_lowercase();

    while cursor < text.len() {
        match lower[cursor..].find(lo.as_str()) {
            None => {
                result.push_str(&text[cursor..]);
                break;
            }
            Some(rel) => {
                let start = cursor + rel;
                result.push_str(&text[cursor..start]);
                let after_open = start + open.len();
                match lower[after_open..].find(lc.as_str()) {
                    None => break,
                    Some(rel2) => cursor = after_open + rel2 + close.len(),
                }
            }
        }
    }
    result
}

/// Strip all known Codex injected scaffolding blocks, then character-level `<>` sanitization.
/// Mirrors TypeScript `stripCodexInjectedScaffolding`.
fn strip_codex_injected_scaffolding(text: &str) -> String {
    let mut result = text.to_string();
    for &(open, close) in INJECTED_BLOCKS {
        result = remove_marked_blocks(&result, open, close);
    }
    result
        .lines()
        .filter(|l| !l.trim_start().starts_with("# AGENTS.md instructions for"))
        .collect::<Vec<_>>()
        .join("\n")
        .replace(['<', '>'], "")
        .trim()
        .to_string()
}

fn is_injected_message(role: &str, text: &str) -> bool {
    if role == "developer" || role == "system" {
        return true;
    }
    let stripped = text.trim_start();
    if stripped.starts_with("<turn_aborted>") {
        return true;
    }
    // Mirrors TypeScript: strip known scaffolding blocks; if < 50 chars remain it is pure
    // injection.  If ≥ 50 chars remain the user appended a real request after the injected
    // header, so we keep the whole message (parse_codex_rollout handles it as-is).
    if INJECTED_PREFIXES.iter().any(|p| stripped.starts_with(p)) {
        return strip_codex_injected_scaffolding(text).len() < 50;
    }
    false
}

fn normalize_path(p: &str) -> String {
    p.replace('\\', "/").to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── is_injected_message ───────────────────────────────────────────────────

    #[test]
    fn test_developer_role_always_injected() {
        assert!(is_injected_message("developer", "anything"));
    }

    #[test]
    fn test_system_role_always_injected() {
        assert!(is_injected_message("system", "anything"));
    }

    #[test]
    fn test_turn_aborted_injected() {
        assert!(is_injected_message("user", "<turn_aborted>some reason</turn_aborted>"));
    }

    #[test]
    fn test_permissions_prefix_injected() {
        assert!(is_injected_message("user", "<permissions instructions>...</permissions instructions>"));
    }

    #[test]
    fn test_agents_md_injected() {
        assert!(is_injected_message("user", "# AGENTS.md instructions for this repo"));
    }

    #[test]
    fn test_normal_user_message_not_injected() {
        assert!(!is_injected_message("user", "Can you help me with this bug?"));
    }

    #[test]
    fn test_normal_assistant_message_not_injected() {
        assert!(!is_injected_message("assistant", "Sure, here's how you fix it."));
    }

    // ── parse_codex_rollout ───────────────────────────────────────────────────

    #[test]
    fn test_parse_session_meta_and_messages() {
        let jsonl = concat!(
            r#"{"type":"session_meta","payload":{"cwd":"/home/user/project","id":"sess-abc"}}"#, "\n",
            r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"text","text":"Write hello world"}]}}"#, "\n",
            r#"{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"text","text":"Here it is:"}]}}"#, "\n",
        );
        let parsed = parse_codex_rollout(jsonl, true);
        assert_eq!(parsed.cwd.as_deref(), Some("/home/user/project"));
        assert_eq!(parsed.session_id.as_deref(), Some("sess-abc"));
        assert_eq!(parsed.messages.len(), 2);
        assert_eq!(parsed.messages[0].role, "user");
        assert_eq!(parsed.messages[0].content, "Write hello world");
        assert_eq!(parsed.messages[1].role, "assistant");
    }

    #[test]
    fn test_skips_developer_injected_messages() {
        let jsonl = concat!(
            r#"{"type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"text","text":"system config"}]}}"#, "\n",
            r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"text","text":"real question"}]}}"#, "\n",
        );
        let parsed = parse_codex_rollout(jsonl, true);
        assert_eq!(parsed.messages.len(), 1);
        assert_eq!(parsed.messages[0].content, "real question");
    }

    #[test]
    fn test_extracts_ide_context_request() {
        // \n must be actual newlines so the parser can find the marker
        let text = "# Context from my IDE setup:\n## My request for Codex:\nFix the bug";
        let line = serde_json::json!({
            "type": "response_item",
            "payload": {
                "type": "message", "role": "user",
                "content": [{"type": "text", "text": text}]
            }
        })
        .to_string();
        let parsed = parse_codex_rollout(&format!("{line}\n"), true);
        assert_eq!(parsed.messages.len(), 1);
        assert_eq!(parsed.messages[0].content, "Fix the bug");
    }

    #[test]
    fn test_skips_non_message_response_items() {
        let jsonl = concat!(
            r#"{"type":"response_item","payload":{"type":"function_call","role":"assistant","content":[]}}"#, "\n",
            r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"text","text":"hello"}]}}"#, "\n",
        );
        let parsed = parse_codex_rollout(jsonl, true);
        assert_eq!(parsed.messages.len(), 1);
    }

    #[test]
    fn test_empty_jsonl() {
        let parsed = parse_codex_rollout("", true);
        assert!(parsed.messages.is_empty());
        assert!(parsed.cwd.is_none());
    }

    #[test]
    fn test_skips_malformed_json_and_unknown_types() {
        // Mirrors the TypeScript comprehensive rollout test: empty lines, malformed JSON,
        // unknown record types, injected prefixes, and valid messages all in one file.
        let line_user = serde_json::json!({
            "type": "response_item",
            "payload": {"type": "message", "role": "user", "content": [{"type": "text", "text": "What is Rust?"}]}
        }).to_string();
        let line_assistant = serde_json::json!({
            "type": "response_item",
            "payload": {"type": "message", "role": "assistant", "content": [{"type": "text", "text": "A systems language."}]}
        }).to_string();
        let line_developer = serde_json::json!({
            "type": "response_item",
            "payload": {"type": "message", "role": "developer", "content": [{"type": "text", "text": "injected config"}]}
        }).to_string();
        let line_injected_prefix = serde_json::json!({
            "type": "response_item",
            "payload": {"type": "message", "role": "user", "content": [{"type": "text", "text": "<permissions instructions>do not harm</permissions instructions>"}]}
        }).to_string();
        let line_unknown_type = serde_json::json!({
            "type": "unknown_record",
            "payload": {"data": "ignored"}
        }).to_string();
        let line_meta = serde_json::json!({
            "type": "session_meta",
            "payload": {"cwd": "/workspace/project", "id": "sess-xyz"}
        }).to_string();

        let raw = format!(
            "\n\
             not-json-at-all\n\
             {line_meta}\n\
             \n\
             {line_developer}\n\
             {line_injected_prefix}\n\
             {line_unknown_type}\n\
             {line_user}\n\
             {line_assistant}\n\
             {{broken\n"
        );

        let parsed = parse_codex_rollout(&raw, true);
        assert_eq!(parsed.cwd.as_deref(), Some("/workspace/project"));
        assert_eq!(parsed.session_id.as_deref(), Some("sess-xyz"));
        // Only the two real messages should survive
        assert_eq!(parsed.messages.len(), 2);
        assert_eq!(parsed.messages[0].role, "user");
        assert_eq!(parsed.messages[0].content, "What is Rust?");
        assert_eq!(parsed.messages[1].role, "assistant");
        assert_eq!(parsed.messages[1].content, "A systems language.");
    }

    #[test]
    fn test_injected_prefix_short_trailing_content_filtered() {
        // After stripping the injected block the remainder is "Actual user question" (< 50 chars),
        // so the message is treated as pure injection and dropped — matches TypeScript behaviour.
        let text = "<permissions instructions>rules</permissions instructions>\nActual user question";
        let line = serde_json::json!({
            "type": "response_item",
            "payload": {"type": "message", "role": "user", "content": [{"type": "text", "text": text}]}
        }).to_string();
        let parsed = parse_codex_rollout(&format!("{line}\n"), true);
        assert!(parsed.messages.is_empty());
    }

    #[test]
    fn test_injected_prefix_substantial_trailing_content_kept() {
        // After stripping the injected block the remainder is ≥ 50 chars → real user request,
        // kept as-is.  This matches TypeScript's 50-char threshold behaviour.
        let long_request = "Please help me implement a full authentication system with JWT tokens.";
        assert!(long_request.len() >= 50);
        let text = format!("<permissions instructions>rules</permissions instructions>\n{long_request}");
        let line = serde_json::json!({
            "type": "response_item",
            "payload": {"type": "message", "role": "user", "content": [{"type": "text", "text": text}]}
        }).to_string();
        let parsed = parse_codex_rollout(&format!("{line}\n"), true);
        assert_eq!(parsed.messages.len(), 1);
        assert!(parsed.messages[0].content.contains("authentication system"));
    }

    #[test]
    fn test_multi_part_content_joined() {
        let line = serde_json::json!({
            "type": "response_item",
            "payload": {
                "type": "message", "role": "user",
                "content": [
                    {"type": "text", "text": "Hello"},
                    {"type": "text", "text": " world"}
                ]
            }
        }).to_string();
        let parsed = parse_codex_rollout(&format!("{line}\n"), true);
        assert_eq!(parsed.messages.len(), 1);
        assert_eq!(parsed.messages[0].content, "Hello world");
    }

    // ── normalize_path ────────────────────────────────────────────────────────

    #[test]
    fn test_normalize_path_backslash() {
        assert_eq!(normalize_path("C:\\Users\\foo"), "c:/users/foo");
    }

    #[test]
    fn test_normalize_path_lowercase() {
        assert_eq!(normalize_path("/Home/User/Project"), "/home/user/project");
    }
}
