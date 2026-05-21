#!/usr/bin/env bash
# Edo Tensei — Rust vs TypeScript session scanner benchmark
# Usage: bash bench/run_bench.sh [--projects N] [--sessions-per-project M] [--messages-per-session K] [--full]
set -euo pipefail

PROJECTS=20
SESSIONS=10
MESSAGES=40
FULL=""
RUST_FULL=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --projects)              PROJECTS=$2; shift 2 ;;
    --sessions-per-project)  SESSIONS=$2; shift 2 ;;
    --messages-per-session)  MESSAGES=$2; shift 2 ;;
    --full)                  FULL="--full"; RUST_FULL="--full"; shift ;;
    *) shift ;;
  esac
done

BENCH_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUST_BIN="$BENCH_DIR/crates/edo-scanner/target/release/edo-scanner"
DATA_DIR="/tmp/edo-bench/claude/projects"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Edo Tensei — Rust vs TypeScript benchmark"
echo "  Projects: $PROJECTS  Sessions/project: $SESSIONS  Msgs/session: $MESSAGES  Full: ${FULL:-no}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. Generate fixtures ──────────────────────────────────────────────────────
echo ""
echo "▶ Generating fixtures…"
node "$BENCH_DIR/bench/gen_fixtures.mjs" \
  --projects "$PROJECTS" \
  --sessions-per-project "$SESSIONS" \
  --messages-per-session "$MESSAGES" \
  --dir "$DATA_DIR"

TOTAL=$(( PROJECTS * SESSIONS ))
echo "  Total session files: $TOTAL"

# ── 2. Rust benchmark ─────────────────────────────────────────────────────────
echo ""
echo "▶ Rust (release binary, rayon parallel)…"
# Warm up filesystem cache
"$RUST_BIN" scan --scan-path "$DATA_DIR" --ide claude $RUST_FULL > /dev/null 2>&1 || true

RUST_START=$(date +%s%3N)
RUST_OUT=$("$RUST_BIN" scan --scan-path "$DATA_DIR" --ide claude $RUST_FULL 2>/dev/null)
RUST_END=$(date +%s%3N)
RUST_MS=$(( RUST_END - RUST_START ))
RUST_SESSIONS=$(echo "$RUST_OUT" | grep -c '"type":"session"' || true)
RUST_DONE=$(echo "$RUST_OUT" | grep '"type":"done"' | head -1)
RUST_INTERNAL_MS=$(echo "$RUST_DONE" | grep -o '"durationMs":[0-9]*' | grep -o '[0-9]*' || echo "?")

echo "  Sessions returned : $RUST_SESSIONS"
echo "  Internal durationMs: $RUST_INTERNAL_MS ms"
echo "  Wall-clock: $RUST_MS ms"

# ── 3. TypeScript benchmark ───────────────────────────────────────────────────
echo ""
echo "▶ TypeScript (Node.js, async I/O)…"
# Warm up
node "$BENCH_DIR/bench/bench_ts.mjs" --dir "$DATA_DIR" $FULL > /dev/null 2>&1 || true

TS_START=$(date +%s%3N)
TS_OUT=$(node "$BENCH_DIR/bench/bench_ts.mjs" --dir "$DATA_DIR" $FULL 2>/dev/null)
TS_END=$(date +%s%s 2>/dev/null || date +%s%3N)
TS_END=$(date +%s%3N)
TS_MS=$(( TS_END - TS_START ))
TS_SESSIONS=$(echo "$TS_OUT" | grep '"sessions"' | grep -o '"sessions":[0-9]*' | grep -o '[0-9]*' || echo "?")
TS_INTERNAL_MS=$(echo "$TS_OUT" | grep '"elapsedMs"' | grep -o '"elapsedMs":[0-9]*' | grep -o '[0-9]*' || echo "?")

echo "  Sessions returned : $TS_SESSIONS"
echo "  Internal elapsedMs: $TS_INTERNAL_MS ms"
echo "  Wall-clock: $TS_MS ms"

# ── 4. Summary ────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  RESULTS ($TOTAL sessions, $([ -n "$FULL" ] && echo full || echo lazy) mode)"
echo "  Rust  internal : ${RUST_INTERNAL_MS} ms"
echo "  TS    internal : ${TS_INTERNAL_MS} ms"
echo "  Rust  wall     : ${RUST_MS} ms"
echo "  TS    wall     : ${TS_MS} ms"
if [[ "$RUST_MS" -gt 0 && "$TS_MS" -gt 0 ]]; then
  SPEEDUP=$(echo "scale=1; $TS_MS / $RUST_MS" | bc)
  echo "  Speedup (wall) : ${SPEEDUP}×  (Rust faster)"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
