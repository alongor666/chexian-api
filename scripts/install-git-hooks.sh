#!/bin/bash
# 安装 Git hooks，防止坏代码推出本机
set -e

HOOKS_DIR="$(git rev-parse --git-dir)/hooks"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

install_hook() {
  local name="$1"
  local src="$SCRIPT_DIR/hooks/$name"
  local dest="$HOOKS_DIR/$name"

  if [ ! -f "$src" ]; then
    echo "⚠️  未找到 $src，跳过"
    return
  fi

  cp "$src" "$dest"
  chmod +x "$dest"
  echo "✅ 已安装 $name"
}

install_hook "pre-push"

echo ""
echo "Git hooks 安装完成。"
echo "下次 git push 前会自动执行 bun run test --run + bun run typecheck。"
