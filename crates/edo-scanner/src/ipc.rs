use serde_json::json;

use crate::types::CapturedSession;

pub fn emit_session(session: &CapturedSession, include_messages: bool) {
    let mut value = serde_json::to_value(session).unwrap_or_default();
    if let serde_json::Value::Object(ref mut map) = value {
        map.insert("type".into(), json!("session"));
        map.insert("messageCount".into(), json!(session.messages.len()));
        if !include_messages {
            map.remove("messages");
        }
    }
    println!("{value}");
}

pub fn emit_done(total: usize, duration_ms: u128) {
    println!("{}", json!({"type": "done", "total": total, "durationMs": duration_ms}));
}

pub fn emit_error(message: &str) {
    println!("{}", json!({"type": "error", "message": message}));
}
