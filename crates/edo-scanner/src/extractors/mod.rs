pub mod claude;
pub mod codex;
pub mod copilot;
pub mod cursor;
pub mod kiro;

use std::path::Path;

/// Millisecond mtime → ISO 8601 UTC string  e.g. "2024-01-15T09:30:00.000Z"
pub(crate) fn mtime_to_iso(mtime_ms: u64) -> String {
    let secs = mtime_ms / 1000;
    let ms = mtime_ms % 1000;
    // Format as ISO 8601 using only std (no chrono dependency).
    // We derive HMS from Unix epoch manually.
    let (y, mo, d, h, mi, s) = unix_secs_to_datetime(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{ms:03}Z")
}

/// Resolve home directory cross-platform.
pub(crate) fn home_dir() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE").ok().map(std::path::PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").ok().map(std::path::PathBuf::from)
    }
}

/// Safe directory listing — returns empty vec on any error.
pub(crate) fn read_dir_names(path: &Path) -> Vec<String> {
    std::fs::read_dir(path)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter_map(|e| e.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default()
}

/// Safe file metadata.
pub(crate) fn file_metadata(path: &Path) -> Option<std::fs::Metadata> {
    std::fs::metadata(path).ok()
}

// ── Minimal Unix epoch → (year, month, day, hour, min, sec) ──────────────────

fn unix_secs_to_datetime(secs: u64) -> (u32, u32, u32, u32, u32, u32) {
    let s = secs % 60;
    let total_minutes = secs / 60;
    let mi = total_minutes % 60;
    let total_hours = total_minutes / 60;
    let h = total_hours % 24;
    let total_days = total_hours / 24;

    // Days since 1970-01-01
    let (y, mo, d) = days_to_ymd(total_days as u32);
    (y, mo, d, h as u32, mi as u32, s as u32)
}

fn days_to_ymd(mut days: u32) -> (u32, u32, u32) {
    // Algorithm: civil calendar from Howard Hinnant
    days += 719468;
    let era = days / 146097;
    let doe = days % 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    (y, mo, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_epoch_zero() {
        assert_eq!(mtime_to_iso(0), "1970-01-01T00:00:00.000Z");
    }

    #[test]
    fn test_one_second() {
        assert_eq!(mtime_to_iso(1_000), "1970-01-01T00:00:01.000Z");
    }

    #[test]
    fn test_one_minute() {
        assert_eq!(mtime_to_iso(60_000), "1970-01-01T00:01:00.000Z");
    }

    #[test]
    fn test_one_hour() {
        assert_eq!(mtime_to_iso(3_600_000), "1970-01-01T01:00:00.000Z");
    }

    #[test]
    fn test_one_day() {
        assert_eq!(mtime_to_iso(86_400_000), "1970-01-02T00:00:00.000Z");
    }

    #[test]
    fn test_millisecond_precision() {
        assert_eq!(mtime_to_iso(500), "1970-01-01T00:00:00.500Z");
        assert_eq!(mtime_to_iso(1_999), "1970-01-01T00:00:01.999Z");
    }

    #[test]
    fn test_known_date_2024_jan_01() {
        // 2024-01-01T00:00:00Z = 1704067200 seconds
        assert_eq!(mtime_to_iso(1_704_067_200_000), "2024-01-01T00:00:00.000Z");
    }

    #[test]
    fn test_leap_year_feb_29() {
        // 2024-02-29T00:00:00Z = 1709164800 seconds
        assert_eq!(mtime_to_iso(1_709_164_800_000), "2024-02-29T00:00:00.000Z");
    }
}
