#!/bin/bash
# 安装 Git hooks，防止坏代码推出本机
#
# 实施方式（2026-05 升级 — B###）：
#   切换为 git config core.hooksPath = scripts/hooks。所有 worktree 共享同一份 hook 源，
#   且 hook 内容跟踪在 git，无需为每个 worktree / 每次 clone 重新安装。
#
# 旧版（cp .git/hooks/<name>）在 worktree add 时不生效（worktree 各有独立 .git/hooks/ 空目录），
# 也导致 post-checkout 在 worktree 创建时无法自动装子项目依赖。
#
# 兼容：若发现 .git/hooks/ 下有旧版本 cp 的 pre-commit/pre-push/commit-msg，会清除避免双跑。

set -e

ROOT="$(git rev-parse --show-toplevel)"
HOOKS_SRC_DIR="$ROOT/scripts/hooks"

# 验证源文件齐全 + 加可执行权限
for HOOK in pre-commit commit-msg pre-push post-checkout; do
  if [ ! -f "$HOOKS_SRC_DIR/$HOOK" ]; then
    echo "❌ 缺少 $HOOKS_SRC_DIR/$HOOK"
    exit 1
  fi
  chmod +x "$HOOKS_SRC_DIR/$HOOK"
done

# 切换 hooksPath（一次设置，所有 worktree 共享）
git config core.hooksPath scripts/hooks
echo "✅ git config core.hooksPath = scripts/hooks"

# 清理旧版 .git/hooks/ 副本（防止双跑）
LEGACY_DIR="$(git rev-parse --git-common-dir)/hooks"
CLEANED=0
for HOOK in pre-commit commit-msg pre-push; do
  if [ -f "$LEGACY_DIR/$HOOK" ]; then
    rm "$LEGACY_DIR/$HOOK"
    CLEANED=$((CLEANED + 1))
  fi
done
if [ "$CLEANED" -gt 0 ]; then
  echo "🧹 已清理 $CLEANED 个旧版 .git/hooks/ 副本"
fi

echo ""
echo "Git hooks 安装完成（hooksPath 机制 · 4 hooks）。"
echo "  pre-commit     : 类型检查 + 大文件拦截 + 生成报告拦截"
echo "  commit-msg     : 语义化提交消息校验（feat|fix|refactor|...）"
echo "  pre-push       : 单测 + 类型检查 + 治理校验 + 冲突标记扫描"
echo "  post-checkout  : LFS 转发 + worktree 创建时自动 bun install 缺失的子项目"
echo ""
echo "💡 所有 worktree 共享同一份 hook，无需为每个 worktree 单独安装。"
