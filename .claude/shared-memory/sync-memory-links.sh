#!/bin/bash
# sync-memory-links.sh — 自动发现并链接所有车险相关项目到共享记忆
#
# 用法：
#   bash ~/.claude/shared-memory/sync-memory-links.sh
#   bash ~/.claude/shared-memory/sync-memory-links.sh --dry-run
#
# 运行时机：
#   - 项目改名后
#   - 新建车险相关项目后
#   - 发现某个项目记忆丢失时
#
# 匹配规则：项目目录名含 "chexian" 或 "车险" 或 "私董"

SHARED="$HOME/.claude/shared-memory/chexian"
DRY_RUN=false
[ "$1" = "--dry-run" ] && DRY_RUN=true

if [ ! -d "$SHARED" ]; then
    echo "❌ 共享记忆目录不存在: $SHARED"
    exit 1
fi

echo "🔍 扫描 ~/.claude/projects/ 中的车险相关项目..."
echo "   共享记忆: $SHARED ($(ls "$SHARED"/*.md 2>/dev/null | wc -l | tr -d ' ') 个文件)"
echo ""

LINKED=0
SKIPPED=0
CREATED=0

for dir in "$HOME"/.claude/projects/*/; do
    name=$(basename "$dir")

    # 匹配车险相关项目
    if echo "$name" | grep -qiE "chexian|车险|私董"; then
        mem="$dir/memory"

        if [ -L "$mem" ]; then
            target=$(readlink "$mem")
            if [ "$target" = "$SHARED" ]; then
                echo "  ✅ $name → 已链接"
                LINKED=$((LINKED + 1))
            else
                echo "  ⚠️ $name → 链接到其他位置: $target"
                if [ "$DRY_RUN" = false ]; then
                    ln -sfn "$SHARED" "$mem"
                    echo "     → 已修正为 $SHARED"
                    CREATED=$((CREATED + 1))
                else
                    echo "     → [dry-run] 将修正为 $SHARED"
                fi
            fi
        elif [ -d "$mem" ]; then
            echo "  📁 $name → 是真实目录（$(ls "$mem"/*.md 2>/dev/null | wc -l | tr -d ' ') 个文件）"
            if [ "$DRY_RUN" = false ]; then
                # 合并内容到共享目录，然后替换为链接
                cp -n "$mem"/*.md "$SHARED/" 2>/dev/null
                rm -rf "$mem"
                ln -sfn "$SHARED" "$mem"
                echo "     → 已合并并替换为符号链接"
                CREATED=$((CREATED + 1))
            else
                echo "     → [dry-run] 将合并并替换"
            fi
        else
            echo "  ➕ $name → 无 memory，创建链接"
            if [ "$DRY_RUN" = false ]; then
                ln -sfn "$SHARED" "$mem"
                CREATED=$((CREATED + 1))
            fi
        fi
    else
        SKIPPED=$((SKIPPED + 1))
    fi
done

echo ""
echo "=== 完成 ==="
echo "  已链接: $LINKED | 新建/修正: $CREATED | 跳过(非车险): $SKIPPED"
