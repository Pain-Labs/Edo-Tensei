# Find Windsurf (Codeium) Session

## Purpose

Locate the most recent Windsurf Cascade session. Note: Windsurf stores sessions in **binary protobuf format** — direct text reading is not possible. This guide covers path discovery and best-effort text extraction.

## Storage Paths

| OS | Path |
|---|---|
| Linux / macOS | `~/.codeium/windsurf/cascade/*.pb` |
| Windows | `%USERPROFILE%\.codeium\windsurf\cascade\*.pb` |

Each `.pb` file is a binary protobuf. Windsurf does not expose a plaintext session format.

## How to Find

```bash
# Linux/macOS — list sessions newest first
ls -lt ~/.codeium/windsurf/cascade/*.pb 2>/dev/null | head -10

# Windows (PowerShell)
Get-ChildItem "$env:USERPROFILE\.codeium\windsurf\cascade\*.pb" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 10
```

## Best-Effort Text Extraction

Since the format is binary, extract readable UTF-8 strings heuristically:

```bash
# Extract strings >= 30 chars from the most recent .pb file (Linux)
LATEST=$(ls -t ~/.codeium/windsurf/cascade/*.pb 2>/dev/null | head -1)
strings -n 30 "$LATEST" 2>/dev/null | grep -v '^[^a-zA-Z]*$' | tail -100

# Alternative: use Python to extract readable segments
python3 -c "
import sys, re
with open('$LATEST', 'rb') as f:
    data = f.read()
# Extract sequences of printable ASCII >= 30 chars
for m in re.finditer(rb'[\x20-\x7e]{30,}', data):
    text = m.group().decode('ascii', errors='replace')
    # Skip binary-looking strings (low letter density)
    letters = sum(c.isalpha() for c in text)
    if letters / len(text) > 0.6:
        print(text)
" 2>/dev/null | tail -50
```

## Known Limitation

Windsurf's protobuf schema is not public. The text extraction above is heuristic and may miss context or include noise. For reliable handoff, use Windsurf's built-in export feature if available, or manually summarize the session before switching IDEs.
