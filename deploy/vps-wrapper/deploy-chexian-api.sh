#!/bin/bash
# deploy-chexian-api — deployer 用户受限 PM2 操作 wrapper
# 安装位置: /usr/local/bin/deploy-chexian-api
# 配合 sudoers: deployer ALL=(root) NOPASSWD: /usr/local/bin/deploy-chexian-api
#
# 安全设计:
#   - 子命令白名单，只允许 install/start/restart/reload/stop/status/describe/logs/save/doctor/self-update/fix-deps-owner/fix-frontend-owner/verify-natives
#   - start 仅允许固定 ecosystem 文件路径，防止任意脚本执行
#   - install 仅在 /var/www/chexian/server 下执行，防止目录逃逸
#   - self-update 只从固定路径 $APP_DIR/.wrapper-source/ 读取，由 deploy bundle 投放
#   - 自动探测 root nvm 下的 PM2 绝对路径，不依赖 $PATH
set -euo pipefail
umask 0027

# --- 路径探测 ---
auto_detect_nvm() {
  local NVM_DIR="/root/.nvm"
  if [ -d "$NVM_DIR/versions/node" ]; then
    local LATEST
    LATEST=$(ls -1 "$NVM_DIR/versions/node/" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)
    if [ -n "$LATEST" ]; then
      echo "$NVM_DIR/versions/node/$LATEST/bin"
    fi
  fi
}

# 安全: 不接受外部环境变量，只信任 auto_detect_nvm 探测结果
NVM_BIN_DIR="$(auto_detect_nvm)"
if [ -z "$NVM_BIN_DIR" ] || [ ! -x "$NVM_BIN_DIR/pm2" ]; then
  echo "错误: 找不到 PM2。请以 root 执行 'which pm2' 确认路径。" >&2
  exit 1
fi

PM2_BIN="$NVM_BIN_DIR/pm2"
NODE_BIN="$NVM_BIN_DIR/node"
NPM_BIN="$NVM_BIN_DIR/npm"

# 暴露 nvm 路径到 PATH：必要的兼容性补丁。
# 理由：虽然 PM2_BIN/NODE_BIN/NPM_BIN 都用绝对路径调用，但 npm 自身是 node 脚本，
# 其 shebang `#!/usr/bin/env node` 仍需 `node` 在 PATH 中。sudo 默认 secure_path
# 不含 nvm 目录，导致 `"$NPM_BIN" ci` 内部启动 npm 时报：
#   /usr/bin/env: 'node': No such file or directory
# 之前 deploy 失败（PR #380/#381 merge 后 exit 127）的直接根因。
# Phase 0 沙盒预检（B295 doc §3.1）已发现此问题，但当时只写在 doc 里没回写到 wrapper。
export PATH="$NVM_BIN_DIR:$PATH"

# --- 固定常量 ---
APP_DIR="/var/www/chexian/server"
APP_NAME="chexian-api"
ECOSYSTEM="${APP_DIR}/ecosystem.config.cjs"

# --- 原生模块健康检查 + 自愈（共享逻辑）─────────────────────────────────────
# 背景：CN 代理 / registry 抖动 / optional 平台包缺失可能让 node-pre-gyp 预编译下载
#       损坏或缺失，install/rebuild 报"完成"但 .node 截断/缺失；磁盘损坏被运行中
#       进程的内存副本掩盖，直到下次 reload/restart 才引爆 crash-loop → 生产 502
#       （2026-06-06 daily ETL reload 撞 bcrypt 缺失即此机理；memory
#       project_vps_bcrypt_reload_landmine 记录详情）。
# 设计：
#   - install / reload / restart 三个子命令统一前置调用本函数，覆盖所有触发 reload
#     的路径（PR merge / daily ETL / 手工应急）
#   - 健康时单次 require ≈ 30-60ms × 3 模块 ≈ < 200ms，零额外开销
#   - 按分发类型分修复（PR #516 codex review 沉淀，对纯预编译包 npm rebuild 无效）：
#       ① 纯预编译分发型 @duckdb/node-api：facade 包无源码，scripts 为空，
#          .node 在 optional 平台包 @duckdb/node-bindings-<platform>。损坏时
#          只能全量 npm ci --omit=dev 重装重拉 optional 二进制；npm rebuild 是
#          no-op；这一步会重置整个 node_modules，故必须排在源码编译之前。
#       ② 源码可编译型 bcrypt / better-sqlite3：install script 走 node-pre-gyp /
#          node-gyp。预编译下载被腐蚀时 npm_config_build_from_source=true npm
#          rebuild <mod> 强制源码编译绕开。
#   - set -e 兼容：require / 重装 / rebuild 都用 if 包裹（set -e 在 if 条件中
#     失效），避免预期内的损坏返回非零把脚本提前中止；仅当修复后仍加载失败才
#     exit 1（避免半升级上线后 reload 引爆）。
#   - HEAL_RAN 标志：仅在实际触发了重装 / rebuild 后置为 true，供调用方决定
#     是否需要 chown 修正 root-owned 残留（健康路径零文件系统改动）。
# 调用约定：调用方在执行前通过自己的 trap EXIT 处理 chown；本函数只负责诊断 + 修复。
HEAL_RAN=false
heal_natives_or_exit() {
  local context="$1"

  # ① 纯预编译分发型：损坏时全量重装重拉 optional 平台二进制
  for MOD in "@duckdb/node-api"; do
    [ -d "$APP_DIR/node_modules/$MOD" ] || continue
    if "$NODE_BIN" -e "require('$APP_DIR/node_modules/$MOD')" >/dev/null 2>&1; then
      continue
    fi
    HEAL_RAN=true
    echo "[$context] $MOD 预编译二进制加载失败（facade 包，.node 在 optional @duckdb/node-bindings-<platform>），全量重装重拉..." >&2
    if ( cd "$APP_DIR" && "$NPM_BIN" ci --omit=dev ) \
       && "$NODE_BIN" -e "require('$APP_DIR/node_modules/$MOD')" >/dev/null 2>&1; then
      echo "[$context] $MOD 已重装恢复"
    else
      echo "[$context] 错误: $MOD 重装后仍无法加载，中止（避免半升级上线）。" >&2
      echo "[$context]   @duckdb 为纯预编译分发（无源码编译路径），疑似 optional 包 @duckdb/node-bindings-<platform> 的 .node 下载损坏/缺失；" >&2
      echo "[$context]   人工排查: ls $APP_DIR/node_modules/@duckdb/（看 node-bindings-* 是否存在）+ 检查 registry/代理。" >&2
      exit 1
    fi
  done

  # ② 源码可编译型：损坏时 build-from-source 绕开被腐蚀的预编译下载
  for MOD in "bcrypt" "better-sqlite3"; do
    [ -d "$APP_DIR/node_modules/$MOD" ] || continue
    if "$NODE_BIN" -e "require('$APP_DIR/node_modules/$MOD')" >/dev/null 2>&1; then
      continue
    fi
    HEAL_RAN=true
    echo "[$context] $MOD 原生二进制加载失败，从源码重编译..." >&2
    if ( cd "$APP_DIR" && npm_config_build_from_source=true "$NPM_BIN" rebuild "$MOD" ) \
       && "$NODE_BIN" -e "require('$APP_DIR/node_modules/$MOD')" >/dev/null 2>&1; then
      echo "[$context] $MOD 已从源码重编译恢复"
    else
      echo "[$context] 错误: $MOD 重编译后仍无法加载，中止（避免半升级上线）" >&2
      exit 1
    fi
  done
}

# 条件 chown trap：仅在 heal_natives_or_exit 实际触发了 npm ci/rebuild 后
# （会产生 root-owned 子树）才 chown 回 deployer。健康路径不动文件系统时为 no-op。
# install 子命令有自己的强 trap（无条件 chown，因为 npm ci 必然执行），不用本 helper。
register_conditional_chown_trap() {
  trap '[ "$HEAL_RAN" = true ] && chown -R deployer:deployer "$APP_DIR/node_modules" 2>/dev/null || true' EXIT
}

# --- 子命令分发 ---
case "${1:-help}" in
  install)
    # 锁文件驱动安装：要求 server/package-lock.json 存在（由 deploy.yml bundle 提供）
    # npm ci 行为：清空 node_modules 后按 lockfile 严格安装，版本不会漂移
    # 失败模式：lockfile 缺失或与 package.json 不一致 → 立即报错，避免半升级状态
    #
    # 所有权兜底（codex PR #516 复审 P1）：install 里的 npm ci 与下方自愈 rebuild/重装都以
    # root(sudo) 跑，会产生 root-owned 的 node_modules 子树（如 node_modules/express/）。
    # deploy.yml 的 rollback 以 deployer 身份 `rm -rf server/node_modules`，若残留 root-owned
    # 会 Permission denied → 半升级残留——恰好出现在自愈本该处理的 registry/代理失败路径上。
    # 故用 trap EXIT 在 *任何* 退出路径（成功 / 失败 exit 1 / set -e 中断 / npm ci 自身失败）
    # 统一把 node_modules chown 回 deployer——取代散落各处、易在某个 exit 前漏写的手动 chown。
    # （chown 失败容错为 no-op：node_modules 不存在或已是 deployer 时不应影响 wrapper 退出码。）
    trap 'chown -R deployer:deployer "$APP_DIR/node_modules" 2>/dev/null || true' EXIT
    cd "$APP_DIR" && "$NPM_BIN" ci --omit=dev

    # 原生模块自检 + 自愈：共享逻辑见脚本顶部 heal_natives_or_exit。
    # 与本地 scripts/hooks/post-checkout §3 同源策略（按模块分发类型分修复），
    # 但本地用 bun + 不同路径，故各自实现、共享清单 (@duckdb/node-api / bcrypt / better-sqlite3)。
    heal_natives_or_exit "install"

    # 所有权由分支开头的 trap EXIT 统一兜底（成功 / 失败 exit 1 / set -e 中断都会触发），此处无需再 chown
    ;;
  start)
    "$PM2_BIN" start "$ECOSYSTEM" --env production
    ;;
  restart)
    # 前置原生模块自愈：daily ETL 链路只走 reload/restart（不经 install），
    # 磁盘上 .node 损坏（CN 代理腐蚀下载等）被运行中进程内存掩盖时，下次
    # PM2 启动会撞 dlopen 崩 → 生产 502（memory project_vps_bcrypt_reload_landmine）。
    # 健康时 < 200ms 零成本；损坏时按分发类型自愈或 exit 1（避免半升级）。
    register_conditional_chown_trap
    heal_natives_or_exit "restart"
    "$PM2_BIN" restart "$APP_NAME"
    ;;
  reload)
    # delete + start: 确保重读 ecosystem.config.cjs 中的环境变量
    # ⚠️ 有短暂停机窗口（delete 到 start 之间约 1-3 秒）
    # 如果只需热重启且不改 env，用 restart 子命令（零停机）
    #
    # 前置原生模块自愈（同 restart）：daily ETL 链路 sync-and-reload.mjs 走 ssh reload，
    # 不经 install；2026-06-06 daily ETL reload 撞 bcrypt 缺失就是这个空档。
    register_conditional_chown_trap
    heal_natives_or_exit "reload"
    "$PM2_BIN" delete "$APP_NAME" 2>/dev/null || true
    "$PM2_BIN" start "$ECOSYSTEM" --env production
    ;;
  stop)
    "$PM2_BIN" stop "$APP_NAME"
    ;;
  status)
    "$PM2_BIN" list
    ;;
  describe)
    "$PM2_BIN" describe "$APP_NAME"
    ;;
  logs)
    LINES="${2:-50}"
    # 只允许数字，防止注入
    if ! [[ "$LINES" =~ ^[0-9]+$ ]]; then
      echo "错误: logs 参数必须为数字" >&2; exit 1
    fi
    "$PM2_BIN" logs "$APP_NAME" --lines "$LINES" --nostream
    ;;
  save)
    "$PM2_BIN" save
    ;;
  doctor)
    # 只读输出 wrapper 探测到的二进制路径与版本
    # 用途：外部脚本（Phase 0 沙盒、smoke、备份）通过 `eval "$(... doctor)"` 注入环境
    # 避免从 `pm2 describe` 输出中 grep 路径这种脆弱模式
    echo "NODE_BIN=$NODE_BIN"
    echo "NPM_BIN=$NPM_BIN"
    echo "PM2_BIN=$PM2_BIN"
    echo "NODE_VERSION=$("$NODE_BIN" --version 2>&1)"
    ;;
  self-update)
    # 从 deploy bundle 投放的 wrapper 源自我替换。
    # 流程：
    #   1) 由 deploy.yml 在 install 之前 cp 仓库源到固定路径
    #   2) CI ssh 调 `sudo /usr/local/bin/deploy-chexian-api self-update`
    #   3) cmp 检测：无变化 skip，有变化备份后替换
    # 安全：SOURCE 路径固定，不接受参数，无目录逃逸风险
    SOURCE="$APP_DIR/.wrapper-source/deploy-chexian-api.sh"
    CURRENT="/usr/local/bin/deploy-chexian-api"
    if [ ! -f "$SOURCE" ]; then
      echo "[self-update] $SOURCE 不存在，跳过（deploy bundle 未包含 wrapper 源？）"
      exit 0
    fi
    # 语法校验：损坏的源不允许替换 runtime
    if ! bash -n "$SOURCE" 2>/dev/null; then
      echo "[self-update] 错误: 源文件语法不通过 $SOURCE" >&2
      exit 1
    fi
    # 无变化跳过：避免每次 deploy 都重写 wrapper
    if cmp -s "$SOURCE" "$CURRENT"; then
      echo "[self-update] wrapper 已是最新，无需更新"
      exit 0
    fi
    # 备份 + 替换：cp 而非 mv，保留 SELinux 上下文与 inode 关联
    TS=$(date +%Y%m%d%H%M%S)
    cp "$CURRENT" "$CURRENT.bak.$TS"
    cp "$SOURCE" "$CURRENT"
    chmod 755 "$CURRENT"
    echo "[self-update] wrapper 已更新（备份: $CURRENT.bak.$TS）"
    ;;
  fix-deps-owner)
    # backup 阶段死锁预防（B-deploy-backup-owner）：手动 root 操作（如 bcrypt 应急时绕过
    # wrapper 直接 sudo npm ci）会在 node_modules 留下 root-owned 子树，使 deploy.yml backup
    # 阶段 deployer 身份的 `cp -r node_modules .bak` 全量 Permission denied → set -e 中断 →
    # 永远走不到 install 末尾的 chown trap → 死锁。本子命令由 deploy.yml 在 backup *之前*
    # 调用，把所有权归一到 deployer 打破死锁。幂等：node_modules 不存在或已是 deployer 时为 no-op。
    if [ -d "$APP_DIR/node_modules" ]; then
      chown -R deployer:deployer "$APP_DIR/node_modules"
      echo "[fix-deps-owner] node_modules 所有权已归一到 deployer"
    else
      echo "[fix-deps-owner] node_modules 不存在，跳过"
    fi
    ;;
  fix-frontend-owner)
    # 2026-07-10 全站 403 事故（dist.bak 套娃）源头治理：报告流水线/手工 root 操作会在
    # frontend/dist 留下 root-owned 文件，deployer 身份的 rm -rf 删不净，曾把部署逼进
    # "回滚 mv 撞现存目录 → dist.bak 套进 dist 内部 → index.html 消失 → 全站 403"。
    # deploy.yml 换轨已改 rename-based 不再被属主阻塞；本子命令做源头归一：由 deploy.yml
    # 在 backup 之前调用，把 frontend 属主统一回 deployer，让 rm 类清理路径恢复可用。
    # 幂等：目录不存在或已是 deployer 时为 no-op。
    FRONTEND_DIR="/var/www/chexian/frontend"
    if [ -d "$FRONTEND_DIR" ]; then
      chown -R deployer:deployer "$FRONTEND_DIR"
      echo "[fix-frontend-owner] frontend 属主已归一到 deployer"
    else
      echo "[fix-frontend-owner] $FRONTEND_DIR 不存在，跳过"
    fi
    ;;
  verify-natives)
    # 只读检测：分别 require 各原生模块，输出 OK/FAIL 但不触发任何修复。
    # 用途：应急诊断（"reload 前先确认原生模块状态"）/ SOP 手动巡检 / 监控脚本探针。
    # 与 reload / restart 子命令的前置自愈互补：前置自愈是 fail-fix；这里是 fail-report。
    # 退出码：全部 OK 返回 0；任一加载失败返回 1（供脚本判断）。
    EXIT_CODE=0
    for MOD in "@duckdb/node-api" "bcrypt" "better-sqlite3"; do
      if [ ! -d "$APP_DIR/node_modules/$MOD" ]; then
        echo "[verify-natives] $MOD: skip (未安装)"
        continue
      fi
      if "$NODE_BIN" -e "require('$APP_DIR/node_modules/$MOD')" >/dev/null 2>&1; then
        echo "[verify-natives] $MOD: OK"
      else
        echo "[verify-natives] $MOD: FAIL (加载失败，需自愈; 跑 install/reload/restart 触发)"
        EXIT_CODE=1
      fi
    done
    exit $EXIT_CODE
    ;;
  help|*)
    echo "用法: deploy-chexian-api {install|start|restart|reload|stop|status|describe|logs [N]|save|doctor|self-update|fix-deps-owner|fix-frontend-owner|verify-natives}"
    echo ""
    echo "子命令:"
    echo "  install         在 $APP_DIR 执行 npm ci --omit=dev (要求 package-lock.json)"
    echo "  start           启动 PM2 进程 (ecosystem.config.cjs)"
    echo "  restart         重启 PM2 进程 (前置原生模块自愈; 保留环境变量)"
    echo "  reload          删除后重新启动 (前置原生模块自愈; 重读 ecosystem 配置)"
    echo "  stop            停止 PM2 进程"
    echo "  status          查看 PM2 进程列表"
    echo "  describe        查看进程详情"
    echo "  logs [N]        查看最近 N 行日志 (默认 50)"
    echo "  save            保存 PM2 进程列表 (用于开机自启)"
    echo "  doctor          输出探测到的 NODE_BIN/NPM_BIN/PM2_BIN + 版本，供外部脚本 eval"
    echo "  self-update     从 deploy bundle 投放的 wrapper 源自我替换 (CI 在 install 前调用)"
    echo "  fix-deps-owner  把 node_modules 所有权归一到 deployer (CI 在 backup 前调用，防死锁)"
    echo "  fix-frontend-owner  把 frontend 所有权归一到 deployer (CI 在 backup 前调用，防 dist 套娃 403)"
    echo "  verify-natives  只读检测 @duckdb/node-api / bcrypt / better-sqlite3 加载状态 (诊断用)"
    exit 1
    ;;
esac
