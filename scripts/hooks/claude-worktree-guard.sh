#!/usr/bin/env bash
# Claude Code PreToolUse hook：worktree 会话中拦截 Write/Edit「逃逸进主仓」的写入。
#
# 防的是什么：worktree 模式下用【主仓绝对路径】Write/Edit 代码文件 → 改动落进主仓 main 工作区
# （只读基线区），worktree 副本仍是旧版本、全量回归测的也是旧版本。已在 PR #476 / #644(heuristic-
# stonebraker) / #792 三次发作，三次复盘都留「加 PreToolUse hook」TODO（见 .claude/workflow/
# pr-evolution.md）。本 hook 是该 TODO 的落地——代码兜底，不靠纪律（memory
# feedback_prompt_needs_code_backup / feedback_rules_need_automation）。
#
# 为何 hook 而非 EnterWorktree 重锚：重锚改的是会话 cwd（治【相对路径】漂移），但【绝对路径】
# 不受 cwd / 锚点影响——PR #476 根因原文「cwd 切换对 Write/Edit 无效」、PR #783 复盘「已锚
# worktree 仍用主目录绝对路径 Write」，两条都证明重锚救不了绝对路径泄漏。二者互补：重锚治相对
# 路径漂移，本 hook 兜绝对路径逃逸。
#
# 判定（基于 git worktree 拓扑，对「.claude/worktrees/ 嵌套」与「兄弟目录」两种落点均健全，
# 且避开 chexian-api vs chexian-api-sx-g8 字符串前缀陷阱）：
#   1. 解析 file_path（$CLAUDE_TOOL_INPUT 优先，否则 stdin JSON）—— 复用 claude-user-only-guard.sh 写法
#   2. 当前非 linked worktree（git-dir == git-common-dir）→ 放行（主仓/非 worktree 会话，本 hook 不介入）
#   3. 目标在【当前 worktree 根】下 → 放行（worktree 内合法写入）
#   4. 目标逃逸到【主仓根】下（worktree 之外）→ exit 2 拦截
#   5. 目标在别处（其他 worktree / 仓库外如 ~/.claude/）→ 放行（非「泄漏进主仓」，本 hook 不管）
#
# 退出码约定同 claude-user-only-guard.sh：exit 0 放行 / exit 2 拦截并在 stderr 打印理由。
# fail-open：git 不可用 / 拿不到根 → 放行。本 hook 是额外护栏（重锚 + 纪律 + user-only guard 仍在），
# 故障时退回纪律层、不破坏正常 Write/Edit；不用 `set -e`，避免 git rev-parse 失败把脚本顶成异常退出码。

set -uo pipefail

input="${CLAUDE_TOOL_INPUT:-}"
if [ -z "$input" ]; then
    input=$(cat 2>/dev/null || true)
fi
[ -z "$input" ] && exit 0

file_path=$(printf '%s' "$input" \
    | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]+"' \
    | head -1 \
    | sed -E 's/.*"file_path"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' || true)
[ -z "$file_path" ] && exit 0

# 采集 git worktree 拓扑；任一失败即 fail-open 放行
git_dir=$(git rev-parse --git-dir 2>/dev/null || true)
common_dir=$(git rev-parse --git-common-dir 2>/dev/null || true)
wt_root=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$git_dir" ] || [ -z "$common_dir" ] || [ -z "$wt_root" ]; then
    exit 0
fi

# 规范化为绝对路径（解析 .. / 符号链接；不要求路径存在 → 支持 Write 新建文件）。
# 优先 python3（跨平台可靠，本项目 ETL 重度依赖必在）；缺失则降级为字符串拼接（绝对路径足够，
# 三次泄漏都是规范绝对路径）。
abspath() {
    if command -v python3 >/dev/null 2>&1; then
        python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1" 2>/dev/null || printf '%s\n' "$1"
    else
        case "$1" in
            /*) printf '%s\n' "$1" ;;
            *)  printf '%s\n' "$PWD/$1" ;;
        esac
    fi
}

agit_dir=$(abspath "$git_dir")
acommon_dir=$(abspath "$common_dir")

# 非 linked worktree（主仓 / 非 worktree 会话：git-dir == git-common-dir）→ 本 hook 不介入
[ "$agit_dir" = "$acommon_dir" ] && exit 0

main_root=$(abspath "$(dirname "$acommon_dir")")   # 主仓根 = .../.git 的父目录
awt_root=$(abspath "$wt_root")

# 目标绝对路径：绝对路径直接规范化；相对路径相对当前 cwd（= worktree）解析
case "$file_path" in
    /*) target=$(abspath "$file_path") ;;
    *)  target=$(abspath "$PWD/$file_path") ;;
esac
[ -z "$target" ] && exit 0

# 1) 目标在当前 worktree 根下 → 放行（先判 wt：wt 是 main 的子目录时此序保证 worktree 内文件不被误拦）
case "$target" in
    "$awt_root"/*) exit 0 ;;
esac

# 2) 目标逃逸到主仓根下（worktree 之外）→ 拦截
case "$target" in
    "$main_root"/*)
        cat <<EOF >&2
❌ 禁止 worktree 会话向【主仓工作区】写入（worktree 防泄漏护栏 · PR #476/#644/#792 三次发作的代码兜底）

  目标文件：$file_path
  解析绝对：$target
  当前 worktree：$awt_root
  主仓根：$main_root

你在 worktree 会话里，但 Write/Edit 目标落在主仓（worktree 之外）。主仓锁 main 只读
（.claude/rules/worktree-setup.md §A），此写入会泄漏进 main 基线区，且 worktree 全量回归测的是 main 版本。
绝对路径不受 cwd / EnterWorktree 重锚影响——请显式改用 worktree 路径：
  ${awt_root}/<相对路径>
若确为「数据在主仓、代码在 worktree」场景：cd 主仓只许跑只读查询（grep/duckdb/find），其输出的主仓路径禁喂给 Edit。
EOF
        exit 2
        ;;
esac

# 3) 其他位置（别的 worktree / 仓库外，如 ~/.claude/）→ 放行（非「泄漏进主仓」，本 hook 不管）
exit 0
