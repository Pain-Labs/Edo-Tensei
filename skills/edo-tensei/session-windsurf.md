# Windsurf Session

## Storage Paths

| OS | Path |
|---|---|
| Windows (VS Code storage) | `%APPDATA%\Windsurf\User\globalStorage\chatSessions\` |
| Windows (Cascade `.pb`) | `%USERPROFILE%\.codeium\windsurf\cascade\*.pb` |
| Linux / macOS | `~/.codeium/windsurf/cascade/*.pb` |

> ⚠️ **Format: binary / encrypted** — Windsurf stores sessions in a non-public binary format. Direct text reading is not possible.

## Known Limitation

Windsurf's session format is not publicly documented and cannot be read externally. For reliable handoff, use one of these approaches:

1. **Path-based handoff only**: Provide the session file path and let the receiving IDE know it cannot be read externally.
2. **Manual summary**: Ask the user to paste the last few turns of their Windsurf conversation.
3. **Windsurf export** (if available in your version): Check if Windsurf has a built-in export or share feature.

On Windows, check both documented locations and return the selected file's resolved absolute path (`FullName`), not only its basename.

## Best-Effort Text Extraction (Linux, heuristic only)

If you must attempt extraction, readable UTF-8 strings can sometimes be found:

```bash
LATEST=$(ls -t ~/.codeium/windsurf/cascade/*.pb 2>/dev/null | head -1)
strings -n 30 "$LATEST" 2>/dev/null | grep -v '^[^a-zA-Z]*$' | tail -100
```

This is heuristic and may miss context or include noise. Do not rely on it for accurate handoffs.

## Fallback Message

When Windsurf sessions are requested, output:

> I found the Windsurf session path, but the local format is binary and cannot be read externally. Please paste the last few user/assistant turns from your Windsurf conversation, or summarize what was being worked on.
