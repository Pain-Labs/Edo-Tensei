use std::time::Instant;

use rayon::prelude::*;

use crate::extractors::{claude, codex, copilot, cursor, kiro};
use crate::ipc;
use crate::types::CapturedSession;

pub struct ScanOptions {
    pub workspace_path: Option<String>,
    pub ide_filter: Option<String>,
    pub query: Option<String>,
    pub since: Option<String>,
    pub full_messages: bool,
    pub custom_scan_paths: Vec<String>,
}

pub fn run_scan(opts: &ScanOptions) {
    let start = Instant::now();

    let all_ides = ["claude", "cursor", "copilot", "codex", "kiro"];
    let active_ides: Vec<&str> = match opts.ide_filter.as_deref() {
        Some(f) => all_ides.iter().copied().filter(|&ide| ide == f).collect(),
        None => all_ides.to_vec(),
    };

    let mut sessions: Vec<CapturedSession> = active_ides
        .par_iter()
        .flat_map_iter(|&ide| {
            let ws = opts.workspace_path.as_deref();
            let custom = &opts.custom_scan_paths;
            let full = opts.full_messages;
            match ide {
                "claude" => claude::extract_all(ws, custom, full),
                "cursor" => cursor::extract_all(ws, custom, full),
                "copilot" => copilot::extract_all(ws, custom, full),
                "codex" => codex::extract_all(ws, custom, full),
                "kiro" => kiro::extract_all(ws, custom, full),
                _ => vec![],
            }
        })
        .collect();

    if let Some(ref since) = opts.since {
        let since_norm = normalize_since(since);
        sessions.retain(|s| s.captured_at.as_str() >= since_norm.as_str());
    }

    if let Some(ref query) = opts.query {
        let q = query.to_lowercase();
        sessions.retain(|s| session_matches_query(s, &q));
    }

    sessions.sort_unstable_by(|a, b| b.captured_at.cmp(&a.captured_at));

    let total = sessions.len();
    for session in &sessions {
        ipc::emit_session(session, opts.full_messages);
    }

    ipc::emit_done(total, start.elapsed().as_millis());
}

fn session_matches_query(s: &CapturedSession, q: &str) -> bool {
    if s.title.as_deref().map_or(false, |t| t.to_lowercase().contains(q)) {
        return true;
    }
    if s.workspace_path.as_deref().map_or(false, |w| w.to_lowercase().contains(q)) {
        return true;
    }
    s.messages.first().map_or(false, |m| m.content.to_lowercase().contains(q))
}

fn normalize_since(since: &str) -> String {
    if since.len() == 10 {
        format!("{since}T00:00:00.000Z")
    } else {
        since.to_string()
    }
}
