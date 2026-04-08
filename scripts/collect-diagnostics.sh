#!/usr/bin/env bash
# collect-diagnostics.sh — coleta estado do orquestrador para debugging
set -euo pipefail

echo "=== multi-copilot-orchestrator diagnostics ==="
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

echo "--- Copilot processes ---"
pgrep -fla "copilot.*acp" 2>/dev/null || echo "Nenhum processo copilot ativo"
echo ""

echo "--- Git worktrees ---"
git worktree list 2>/dev/null || echo "Não é um repositório git"
echo ""

echo "--- Worktree temp dir ---"
if [ -d "/tmp/copilot-orch" ]; then
  ls -la /tmp/copilot-orch/
else
  echo "/tmp/copilot-orch/ não existe"
fi
echo ""

echo "--- Tracked PIDs ---"
PIDS_FILE="${XDG_STATE_HOME:-$HOME/.local/state}/copilot-orch/pids.json"
if [ -f "$PIDS_FILE" ]; then
  cat "$PIDS_FILE" | python3 -m json.tool 2>/dev/null || cat "$PIDS_FILE"
else
  echo "Arquivo de PIDs não encontrado: $PIDS_FILE"
fi
echo ""

echo "--- Recent logs ---"
LOG_DIR="${COPILOT_ORCH_LOG_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/copilot-orch/logs}"
if [ -d "$LOG_DIR" ]; then
  LATEST=$(ls -t "$LOG_DIR"/*.ndjson 2>/dev/null | head -1)
  if [ -n "$LATEST" ]; then
    echo "Latest: $LATEST"
    echo "Last 10 entries:"
    tail -10 "$LATEST" | while IFS= read -r line; do
      echo "$line" | python3 -m json.tool 2>/dev/null || echo "$line"
    done
  else
    echo "Nenhum arquivo de log encontrado em $LOG_DIR"
  fi
else
  echo "Diretório de logs não existe: $LOG_DIR"
fi
echo ""

echo "--- Errors in latest log ---"
if [ -n "${LATEST:-}" ]; then
  ERROR_COUNT=$(grep -c '"level":50' "$LATEST" 2>/dev/null || echo "0")
  WARN_COUNT=$(grep -c '"level":40' "$LATEST" 2>/dev/null || echo "0")
  echo "Errors: $ERROR_COUNT, Warnings: $WARN_COUNT"
  if [ "$ERROR_COUNT" -gt 0 ]; then
    echo ""
    echo "Error entries:"
    grep '"level":50' "$LATEST" | tail -5 | while IFS= read -r line; do
      echo "$line" | python3 -m json.tool 2>/dev/null || echo "$line"
    done
  fi
fi
echo ""

echo "=== diagnostics complete ==="
