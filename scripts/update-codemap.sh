#!/usr/bin/env bash
# Refresh the ERP code map: graphify AST update (no LLM, no cost, ~1-2 min) -> docs/ai/ERP-CODEMAP.md.
# Run by hand, or automatically after each commit via scripts/install-codemap-hook.sh.
set -u
cd "$(dirname "$0")/.."
mkdir -p graphify-out
LOCK=graphify-out/.codemap.lock
# one run at a time; a lock older than 15 min is a crashed run
if [ -e "$LOCK" ] && [ -z "$(find "$LOCK" -mmin +15 2>/dev/null)" ]; then echo "codemap update already running"; exit 0; fi
trap 'rm -f "$LOCK"' EXIT
date > "$LOCK"
GRAPHIFY="$(command -v graphify 2>/dev/null || echo "$HOME/.local/bin/graphify.exe")"
PY="$(command -v python3 2>/dev/null || command -v python)"
"$GRAPHIFY" update . > graphify-out/.codemap.log 2>&1 || { echo "graphify update failed, see graphify-out/.codemap.log"; exit 1; }
"$PY" scripts/build-codemap.py
"$PY" scripts/build-jarvis-graph.py
