#!/bin/bash
# Pre-commit hook for Claude Code
# This script runs before user submits a prompt

set -e

echo "[Pre-commit] Checking code quality..."

# Check if we're in a git repository
if git rev-parse --git-dir > /dev/null 2>&1; then
  # Check for unstaged changes
  if [ -n "$(git status --porcelain)" ]; then
    echo "[Pre-commit] ⚠️  You have unstaged changes"
    echo "[Pre-commit] 💡 Consider staging them with: git add ."
  fi
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
  echo "[Pre-commit] ⚠️  node_modules not found. Run: bun install"
fi

# Check if tests pass (optional, can be enabled if needed)
# if [ -f "package.json" ]; then
#   echo "[Pre-commit] Running tests..."
#   bun test --run 2>&1 | head -20
# fi

echo "[Pre-commit] ✅ Pre-commit checks completed"

exit 0
