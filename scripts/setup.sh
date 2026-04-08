#!/usr/bin/env bash
set -euo pipefail

echo "=== multi-copilot-orchestrator setup ==="

# 1. Check Node version
if ! command -v node >/dev/null; then
  echo "ERROR: Node.js not found" >&2
  exit 1
fi
node_major=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$node_major" -lt 22 ]; then
  echo "ERROR: Node 22+ required (found $(node -v))" >&2
  exit 1
fi
echo "OK: Node $(node -v)"

# 2. Check git
if ! command -v git >/dev/null; then
  echo "ERROR: git not found" >&2
  exit 1
fi
echo "OK: git $(git --version | head -1)"

# 3. Check copilot CLI (warn only — mock mode works without it)
if ! command -v copilot >/dev/null; then
  echo "WARN: 'copilot' CLI not found. Install with:" >&2
  echo "  npm i -g @github/copilot" >&2
  echo "Or use only --mock mode." >&2
else
  echo "OK: copilot found"
fi

# 4. Install deps
echo "Installing dependencies..."
npm ci 2>/dev/null || npm install

# 5. Typecheck
echo "Running typecheck..."
npm run typecheck

# 6. Run tests
echo "Running tests..."
npx vitest run

echo ""
echo "Setup complete!"
