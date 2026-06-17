#!/usr/bin/env bash
# Claude Code PreToolUse hook：拦截 Write/Edit 到 AGENTS.md §8.3 user-only 路径
#
# 输入：stdin JSON（新版 Claude Code）或 $CLAUDE_TOOL_INPUT 环境变量（旧版/兼容）
# 输出：exit 0 放行 / exit 2 拦截并在 stderr 打印拒绝理由
#
# 名单来源：AGENTS.md §8.3 user-only 表
# - .claude/shared-memory/**            （项目内 git tracked 共享记忆）
# - ~/.claude/shared-memory/**          （用户级共享记忆根目录）
# - .claude/scheduled_tasks.lock        （调度运行时 lock，gitignore）
# - ~/.claude/projects/**/memory/**     （auto-memory 与用户手工 memory）
#
# 豁免：平台 auto-memory 工具入口（mcp__ccd_session__memory_* 等）不走 Write/Edit，
# 本 hook 仅 matcher 到 Write/Edit，故自然不会拦到平台 auto-memory 写入。

set -euo pipefail

input="${CLAUDE_TOOL_INPUT:-}"
if [ -z "$input" ]; then
    input=$(cat 2>/dev/null || true)
fi

if [ -z "$input" ]; then
    exit 0
fi

file_path=$(printf '%s' "$input" \
    | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]+"' \
    | head -1 \
    | sed -E 's/.*"file_path"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' || true)

if [ -z "$file_path" ]; then
    exit 0
fi

# 用 grep -E + (^|/) 锚定路径段开头，同时覆盖三种 file_path 形式：
#   1. 绝对路径   /Users/.../.claude/shared-memory/foo.md   → 命中（/.claude/）
#   2. ./ 前缀    ./.claude/shared-memory/foo.md            → 命中（/.claude/）
#   3. 裸相对路径 .claude/shared-memory/foo.md              → 命中（^\.claude/）
# 之前的 case "*/.claude/..." 仅匹配 1+2，漏 3（PR #666 owner review #1 blocker）。
USER_ONLY_REGEX='(^|/)\.claude/(shared-memory/|scheduled_tasks\.lock$|projects/[^/]+/memory/)'
if printf '%s' "$file_path" | grep -qE "$USER_ONLY_REGEX"; then
    cat <<EOF >&2
❌ 禁止 AI 修改 user-only 路径（AGENTS.md §8.3）

  目标文件：$file_path

AGENTS.md §8.3 规定：读始终允许；写禁止。

用户对话中要求修改 user-only 路径时的 AI 响应规范：
  1. 不直接改：即使用户明确要求，AI 也不得用 Write/Edit 完成
  2. 提供 diff/patch：给出 <file>:<line> X → Y 的明确方案，让用户手动 apply
  3. 不绕路：禁止借道 Bash here-doc / sed -i / cat > 等方式绕开本拦截

如确属误拦（例如调用方不是 AI 而是用户运行的脚本），由用户在 .claude/settings.local.json
临时禁用本 hook。
EOF
    exit 2
fi

exit 0
