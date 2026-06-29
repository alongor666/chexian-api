#!/bin/bash
# scripts/hooks/lib/heal-server-native.sh
# 共享库：server 原生模块「健康检查 + 分级自愈」的单一事实源。
# 靠 source 注入函数，不可独立执行；顶层无副作用代码（source 零开销）。
#
# 消费方：
#   · scripts/hooks/pre-push     — 推送前前置兜底（覆盖 harness EnterWorktree 创建的 worktree）
#   · scripts/hooks/post-checkout — git worktree add / 缺依赖后的腐蚀自愈
#
# 为什么需要（两次复发，见 .claude/rules/worktree-setup.md §B + pr-evolution.md R20/#844）：
#   harness 原生 EnterWorktree（落点 .claude/worktrees/<name>/）创建 worktree 时**不触发**
#   post-checkout（仅 `git worktree add` 触发）→ server/node_modules 大面积缺失 →
#   pre-push 的 `bun run test` 在*加载阶段*整片失败（典型 25 个 agent-*.test.ts 报
#   `Cannot find module .../bcrypt_lib.node`），与被测代码无关却阻塞 push。
#
# 三个 server 原生模块（与 server/package.json 依赖对齐）的分发类型差异：
#   · bcrypt / better-sqlite3：含 C++ 源码，可 `build-from-source` 重编译。
#   · @duckdb/node-api：facade 包 scripts 为空、无源码可编译；真正的 .node 在 optional
#     平台包 @duckdb/node-bindings-<platform> 里 → 只删 facade 时 bun 仍见 bindings 认为
#     已装、不重拉 → 必须删**整个 @duckdb scope** 重装才会重拉 bindings。
#
# 失败模式与对策：
#   ① 缺失（EnterWorktree 未触发安装）：node 报 `Cannot find module`
#      → `bun install --cwd server --force`（prebuilt，实测 ~2s 装 257 包，不编译不 OOM）★ 最快
#   ② 腐蚀（CN 代理腐蚀预编译下载）：node 报 `dlopen` / `__LINKEDIT ... extends beyond end of file`
#      → per-package 重建：源码型 build-from-source；@duckdb 删 scope 重拉。
#   ⚠️ 陷阱（pr-evolution.md #844 实测）：**全量** `npm_config_build_from_source=true bun install --force`
#      会强制 better-sqlite3 从源码编译，内存压力下 `make` 被 `Killed: 9`（OOM），反而把原本正常
#      的 better-sqlite3 也搞坏。故**全量 --force 一定不带 build_from_source**；仅对单个确认腐蚀
#      的包才 build-from-source（即 heal_native_rebuild_one，逐包不会同时编译触发 OOM）。

# server 三原生模块（单一事实源；将来加原生依赖只改这里，pre-push / post-checkout 自动覆盖）。
HEAL_NATIVE_MODULES=("bcrypt" "better-sqlite3" "@duckdb/node-api")

# 单次 node 进程 require 全部模块 → 0=全可加载 / 1=有缺失或损坏（或 node_modules 不存在）。
# 正常路径（全健康）只 1 次 node 启动（~80ms），零定位开销——这是「对正常 worktree 零开销」的关键。
# 模块名经 argv 传入（不在 node -e 里硬编码），保持 HEAL_NATIVE_MODULES 为唯一事实源。
heal_native_all_ok() {
  local server_dir="$1"
  [ -d "$server_dir/node_modules" ] || return 1
  ( cd "$server_dir" && node -e 'for (const m of process.argv.slice(1)) require(m)' "${HEAL_NATIVE_MODULES[@]}" ) >/dev/null 2>&1
}

# 单模块可加载？0/1。目录不存在直接判不健康（避免 require 抛错噪声）。
heal_native_module_ok() {
  local server_dir="$1" m="$2"
  [ -d "$server_dir/node_modules/$m" ] || return 1
  ( cd "$server_dir" && node -e 'require(process.argv[1])' "$m" ) >/dev/null 2>&1
}

# 列出不健康模块（每行一个；全健康则空输出）。供调用方逐个定位自愈。
heal_native_unhealthy() {
  local server_dir="$1" m
  for m in "${HEAL_NATIVE_MODULES[@]}"; do
    heal_native_module_ok "$server_dir" "$m" || printf '%s\n' "$m"
  done
}

# 单模块的手动修复指引（供 hook 在自愈失败时打印给用户）。按分发类型给不同命令。
heal_native_manual_hint() {
  case "$1" in
    @duckdb/*) echo "(cd server && rm -rf node_modules/@duckdb && bun install)" ;;
    *)         echo "(cd server && rm -rf node_modules/$1 && npm_config_build_from_source=true bun install)" ;;
  esac
}

# per-package 重建单模块（腐蚀场景）。按分发类型选策略：
#   源码型(bcrypt/better-sqlite3) → 删模块 + build-from-source 从源码重编译（绕开被腐蚀的预编译下载）
#   @duckdb                       → 删整个 @duckdb scope 重拉预编译 bindings（facade 无源码）
# 逐包重建不会像「全量 --force + build_from_source」那样并发编译触发 OOM。
# 0=自愈后健康 / 1=仍坏。
heal_native_rebuild_one() {
  local server_dir="$1" m="$2" rm_target build_env
  case "$m" in
    @duckdb/*) rm_target="node_modules/@duckdb"; build_env="" ;;
    *)         rm_target="node_modules/$m";       build_env="npm_config_build_from_source=true" ;;
  esac
  # env 注入可选环境变量：变量经展开后不会被识别为前缀赋值，必须借 env 生效（build_env 空时 env 直接跑 bun install）。
  ( cd "$server_dir" && rm -rf "$rm_target" && env $build_env bun install ) >/dev/null 2>&1
  heal_native_module_ok "$server_dir" "$m"
}

# 离线兜底（无网络时）：从主 git-common-dir 仓库 cp 健康的 .node 二进制到 worktree。
# 仅修「腐蚀型」（.node 损坏但 js/传递依赖完整）；「缺失型」（包目录/js 不全）须靠 bun install，cp 无济于事。
# 单文件 cp（mkdir -p + cp，避 `cp -R 目录` 的改名陷阱）。0=兜底后健康 / 1=无法兜底或仍坏。
heal_native_cp_one() {
  local server_dir="$1" m="$2" common_dir main_server scope src_root f rel
  common_dir="$( cd "$server_dir" && git rev-parse --git-common-dir 2>/dev/null )" || return 1
  # git-common-dir 可能是相对路径（相对 server_dir），归一为绝对路径。
  case "$common_dir" in
    /*) ;;
    *)  common_dir="$( cd "$server_dir" && cd "$common_dir" 2>/dev/null && pwd )" || return 1 ;;
  esac
  # 主仓 = git-common-dir（即 <主仓>/.git）的父目录；主仓 server 在其下。
  main_server="$( dirname "$common_dir" )/server"
  [ "$main_server" = "$server_dir" ] && return 1            # 自己即主仓，无兜底源
  [ -d "$main_server/node_modules" ] || return 1
  heal_native_module_ok "$main_server" "$m" || return 1     # 主仓须健康，否则 cp 坏的没意义
  scope="$m"; case "$m" in @duckdb/*) scope="@duckdb" ;; esac
  src_root="$main_server/node_modules/$scope"
  [ -d "$src_root" ] || return 1
  while IFS= read -r f; do
    rel="${f#"$main_server"/node_modules/}"
    mkdir -p "$server_dir/node_modules/$( dirname "$rel" )" 2>/dev/null || return 1
    cp "$f" "$server_dir/node_modules/$rel" 2>/dev/null || return 1
  done < <( find "$src_root" -name '*.node' -type f 2>/dev/null )
  heal_native_module_ok "$server_dir" "$m"
}
