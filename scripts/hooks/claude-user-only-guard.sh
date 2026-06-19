#!/usr/bin/env bash
# Claude Code PreToolUse hook：拦截 Write/Edit 到 AGENTS.md §8.3 user-only 路径
#
# 输入：stdin JSON（新版 Claude Code）或 $CLAUDE_TOOL_INPUT 环境变量（旧版/兼容）
# 输出：exit 0 放行 / exit 2 拦截并在 stderr 打印拒绝理由
#
# 名单来源：AGENTS.md §8.3 user-only 表，分两档：
#   【硬锁档·无授权开关】
#     - .claude/shared-memory/**          （项目内 git tracked 共享记忆，有越权事故史）
#     - ~/.claude/shared-memory/**        （用户级共享记忆根目录）
#     - .claude/scheduled_tasks.lock      （调度运行时 lock，gitignore）
#   【可授权档·用户可拨开关放行】
#     - ~/.claude/projects/**/memory/**   （平台 auto-memory 与用户手工 memory）
#
# 用户授权开关（仅对【可授权档】memory 路径生效；硬锁档不受开关影响）：
#   1. 环境变量 CLAUDE_USER_ONLY_WRITE_OK=1 —— 长期授权，在 .claude/settings.local.json 的 env 段设（需重启会话）
#   2. 哨兵文件 .claude/.user-only-write-ok（仓库内）或 ~/.claude/.user-only-write-ok（全局）—— 临时授权，touch 建 / rm 撤，即时生效
# 任一命中即放行，并向 stderr 打印审计提示。
# 🛑【AI 会话禁止自行设置该环境变量或创建该哨兵文件】—— 开关只能由用户本人拨动；AI 自拨等同自我授权后门。

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

# 用 grep -E + (^|/) 锚定路径段开头，同时覆盖三种 file_path 形式（绝对 / ./ 前缀 / 裸相对，见 PR #666）。
# 分两档正则：硬锁档无开关，memory 档可授权。
STRICT_REGEX='(^|/)\.claude/(shared-memory/|scheduled_tasks\.lock$)'
MEMORY_REGEX='(^|/)\.claude/projects/[^/]+/memory/'

# ── 硬锁档：shared-memory / lock —— 无论开关，一律拦截 ──
if printf '%s' "$file_path" | grep -qE "$STRICT_REGEX"; then
    cat <<EOF >&2
❌ 禁止 AI 修改 user-only 路径（AGENTS.md §8.3 · 硬锁档，无授权开关）

  目标文件：$file_path

shared-memory / scheduled_tasks.lock 为硬锁（shared-memory 有两次越权事故史）。
AGENTS.md §8.3 规定：读始终允许；写禁止。AI 须给出 <file>:<line> 的 diff/patch 让用户手动 apply，不绕路。
EOF
    exit 2
fi

# ── 可授权档：~/.claude/projects/**/memory/** —— 用户拨开关即放行 ──
if printf '%s' "$file_path" | grep -qE "$MEMORY_REGEX"; then
    gate=""
    if [ "${CLAUDE_USER_ONLY_WRITE_OK:-}" = "1" ]; then
        gate="环境变量 CLAUDE_USER_ONLY_WRITE_OK=1"
    else
        repo_root=$(git rev-parse --show-toplevel 2>/dev/null || true)
        if [ -n "$repo_root" ] && [ -e "$repo_root/.claude/.user-only-write-ok" ]; then
            gate="哨兵 $repo_root/.claude/.user-only-write-ok"
        elif [ -e "$HOME/.claude/.user-only-write-ok" ]; then
            gate="哨兵 $HOME/.claude/.user-only-write-ok"
        fi
    fi

    if [ -n "$gate" ]; then
        echo "⚠ user-only memory 写入已被【用户授权】放行（${gate}），本次允许：${file_path}" >&2
        exit 0
    fi

    cat <<EOF >&2
❌ 禁止 AI 修改 user-only memory 路径（AGENTS.md §8.3 · 可授权档，当前未授权）

  目标文件：$file_path

默认 AI 不得用 Write/Edit 改 memory。若要放行，请【用户本人】拨动以下任一开关：
  • 临时（即时生效）：touch .claude/.user-only-write-ok        # 用完 rm 撤销
                     或 touch ~/.claude/.user-only-write-ok    # 全局，跨 worktree
  • 长期：在 .claude/settings.local.json 的 env 段设 CLAUDE_USER_ONLY_WRITE_OK=1（需重启会话）
🛑 AI 会话禁止自行设置上述开关。未授权时按 §8.3：给出 diff/patch 让用户手动 apply，不绕路。
EOF
    exit 2
fi

exit 0
