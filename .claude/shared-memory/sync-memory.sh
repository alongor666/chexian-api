#!/bin/bash
# sync-memory.sh — 双向同步：git 仓库 ↔ ~/.claude/shared-memory/chexian/
#
# 策略：以最新修改时间为准，文件级别合并（不覆盖更新的）
#
# 用法：
#   bash .claude/shared-memory/sync-memory.sh          # 双向同步
#   bash .claude/shared-memory/sync-memory.sh --push    # 仅 local→git（提交前）
#   bash .claude/shared-memory/sync-memory.sh --pull    # 仅 git→local（clone后）
#
# 自动触发：
#   - SessionStart hook（每次启动 Claude Code 时）
#   - pre-commit hook（提交前推送最新记忆到 git）

set -euo pipefail

# 两个目录
LOCAL="$HOME/.claude/shared-memory/chexian"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GIT_DIR="$SCRIPT_DIR"

MODE="${1:-sync}"

mkdir -p "$LOCAL" "$GIT_DIR"

sync_dir() {
    local src="$1" dst="$2" label="$3"
    local count=0
    for f in "$src"/*.md "$src"/*.sh; do
        [ -f "$f" ] || continue
        fname=$(basename "$f")
        dst_file="$dst/$fname"
        if [ ! -f "$dst_file" ]; then
            cp "$f" "$dst_file"
            count=$((count + 1))
        elif [ "$f" -nt "$dst_file" ]; then
            cp "$f" "$dst_file"
            count=$((count + 1))
        fi
    done
    [ $count -gt 0 ] && echo "  $label: $count 个文件更新" || echo "  $label: 已是最新"
}

case "$MODE" in
    --push)
        echo "📤 推送记忆: local → git"
        sync_dir "$LOCAL" "$GIT_DIR" "local→git"
        ;;
    --pull)
        echo "📥 拉取记忆: git → local"
        sync_dir "$GIT_DIR" "$LOCAL" "git→local"
        ;;
    *)
        echo "🔄 双向同步记忆"
        sync_dir "$LOCAL" "$GIT_DIR" "local→git"
        sync_dir "$GIT_DIR" "$LOCAL" "git→local"
        ;;
esac

# 确保符号链接正确
LINK="$HOME/.claude/projects/-Users-alongor666-Downloads------DUD-chexian-api/memory"
if [ ! -L "$LINK" ] || [ "$(readlink "$LINK")" != "$LOCAL" ]; then
    mkdir -p "$(dirname "$LINK")"
    ln -sfn "$LOCAL" "$LINK"
    echo "  🔗 修复符号链接"
fi

echo "✅ 同步完成 (local: $(ls "$LOCAL"/*.md 2>/dev/null | wc -l | tr -d ' ') 文件, git: $(ls "$GIT_DIR"/*.md 2>/dev/null | wc -l | tr -d ' ') 文件)"
