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

install_hook "pre-commit"
install_hook "commit-msg"
install_hook "pre-push"

echo ""
echo "Git hooks 安装完成（3 hooks）。"
echo "  pre-commit : 类型检查 + 大文件拦截 + 生成报告拦截"
echo "  commit-msg : 语义化提交消息校验（feat|fix|refactor|...）"
echo "  pre-push   : 单测 + 类型检查 + 治理校验 + 冲突标记扫描"
