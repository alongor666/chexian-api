#!/bin/bash
# deploy-chexian-api — deployer 用户受限 PM2 操作 wrapper
# 安装位置: /usr/local/bin/deploy-chexian-api
# 配合 sudoers: deployer ALL=(root) NOPASSWD: /usr/local/bin/deploy-chexian-api
#
# 安全设计:
#   - 子命令白名单，只允许 install/start/restart/reload/stop/status/describe/logs/save/doctor/self-update
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

# --- 子命令分发 ---
case "${1:-help}" in
  install)
    # 锁文件驱动安装：要求 server/package-lock.json 存在（由 deploy.yml bundle 提供）
    # npm ci 行为：清空 node_modules 后按 lockfile 严格安装，版本不会漂移
    # 失败模式：lockfile 缺失或与 package.json 不一致 → 立即报错，避免半升级状态
    cd "$APP_DIR" && "$NPM_BIN" ci --omit=dev
    # 修复混合所有权：npm ci 通过 sudo 跑会产生 root-owned 子目录（如 node_modules/express/）
    # 这让后续 deploy.yml trap rollback 的 `rm -rf node_modules` 报 Permission denied
    # 修法：install 末尾把 node_modules 整体 chown 到 deployer，保持单一所有权
    chown -R deployer:deployer "$APP_DIR/node_modules"

    # 原生模块自检 + 自愈（与本地 scripts/hooks/post-checkout §3 同源，按模块类型分修复策略）
    # 背景：原生 .node 可能在某次 install 下载/编译失败（典型 CN 代理腐蚀预编译下载），npm ci
    #       报"完成"但 .node 缺失/截断；磁盘损坏被运行中进程的内存副本掩盖，直到下次 reload/deploy
    #       才引爆 crash-loop → 生产 502（2026-06-06 daily ETL reload 撞上 bcrypt 缺失即此机理，
    #       详见 memory project_vps_bcrypt_reload_landmine）。
    # 两类原生模块修复手段不同（PR #516 codex review 指出统一 npm rebuild 对纯预编译包无效）：
    #   ① 纯预编译分发型 @duckdb/node-api：facade 包（package.json scripts 为空），真正的 .node
    #      在 optional 平台包 @duckdb/node-bindings-<platform>（VPS=linux-x64）；npm rebuild 无
    #      build script 可跑 = no-op，修不了 → 必须全量 npm ci 重装重拉 optional 预编译二进制。
    #      重装会重置整个 node_modules，故必须排在源码编译之前。
    #   ② 源码可编译型 bcrypt / better-sqlite3：install script 走 node-pre-gyp / node-gyp，预编译
    #      下载被腐蚀时用 npm_config_build_from_source=true npm rebuild <mod> 强制源码编译绕开。
    # set -e 兼容：require / 重装 / rebuild 都用 `if` 包裹（set -e 在 if 条件中失效），避免预期内
    #       的损坏返回非零把脚本提前中止；仅当修复后仍加载失败才 exit 1（避免半升级上线后 reload 引爆）。
    REBUILT=0

    # ① 纯预编译分发型：损坏时全量重装重拉 optional 平台二进制（重装会重置 node_modules，须在源码编译前）
    for MOD in "@duckdb/node-api"; do
      [ -d "$APP_DIR/node_modules/$MOD" ] || continue
      if "$NODE_BIN" -e "require('$APP_DIR/node_modules/$MOD')" >/dev/null 2>&1; then
        continue  # 健康，跳过
      fi
      echo "[install] $MOD 预编译二进制加载失败（facade 包，.node 在 optional @duckdb/node-bindings-<platform>），全量重装重拉..." >&2
      if ( cd "$APP_DIR" && "$NPM_BIN" ci --omit=dev ) \
         && "$NODE_BIN" -e "require('$APP_DIR/node_modules/$MOD')" >/dev/null 2>&1; then
        echo "[install] $MOD 已重装恢复"
        REBUILT=1
      else
        echo "[install] 错误: $MOD 重装后仍无法加载，中止部署（避免半升级上线）。" >&2
        echo "[install]   @duckdb 为纯预编译分发（无源码编译路径），疑似 optional 包 @duckdb/node-bindings-<platform> 的 .node 下载损坏/缺失；" >&2
        echo "[install]   人工排查: ls $APP_DIR/node_modules/@duckdb/（看 node-bindings-* 是否存在）+ 检查 registry/代理。" >&2
        exit 1
      fi
    done

    # ② 源码可编译型：损坏时 build-from-source 绕开被腐蚀的预编译下载（rebuild 输出不抑制，失败时 CI 日志可见编译错误）
    for MOD in "bcrypt" "better-sqlite3"; do
      [ -d "$APP_DIR/node_modules/$MOD" ] || continue
      if "$NODE_BIN" -e "require('$APP_DIR/node_modules/$MOD')" >/dev/null 2>&1; then
        continue  # 健康，跳过
      fi
      echo "[install] $MOD 原生二进制加载失败，从源码重编译..." >&2
      if ( cd "$APP_DIR" && npm_config_build_from_source=true "$NPM_BIN" rebuild "$MOD" ) \
         && "$NODE_BIN" -e "require('$APP_DIR/node_modules/$MOD')" >/dev/null 2>&1; then
        echo "[install] $MOD 已从源码重编译恢复"
        REBUILT=1
      else
        echo "[install] 错误: $MOD 重编译后仍无法加载，中止部署（避免半升级上线）" >&2
        exit 1
      fi
    done

    # 重装 / rebuild 以 root 跑会重新产生 root-owned 产物 → 再次统一所有权到 deployer
    if [ "$REBUILT" = "1" ]; then
      chown -R deployer:deployer "$APP_DIR/node_modules"
    fi
    ;;
  start)
    "$PM2_BIN" start "$ECOSYSTEM" --env production
    ;;
  restart)
    "$PM2_BIN" restart "$APP_NAME"
    ;;
  reload)
    # delete + start: 确保重读 ecosystem.config.cjs 中的环境变量
    # ⚠️ 有短暂停机窗口（delete 到 start 之间约 1-3 秒）
    # 如果只需热重启且不改 env，用 restart 子命令（零停机）
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
  help|*)
    echo "用法: deploy-chexian-api {install|start|restart|reload|stop|status|describe|logs [N]|save|doctor|self-update}"
    echo ""
    echo "子命令:"
    echo "  install      在 $APP_DIR 执行 npm ci --omit=dev (要求 package-lock.json)"
    echo "  start        启动 PM2 进程 (ecosystem.config.cjs)"
    echo "  restart      重启 PM2 进程 (保留环境变量)"
    echo "  reload       删除后重新启动 (重读 ecosystem 配置)"
    echo "  stop         停止 PM2 进程"
    echo "  status       查看 PM2 进程列表"
    echo "  describe     查看进程详情"
    echo "  logs [N]     查看最近 N 行日志 (默认 50)"
    echo "  save         保存 PM2 进程列表 (用于开机自启)"
    echo "  doctor       输出探测到的 NODE_BIN/NPM_BIN/PM2_BIN + 版本，供外部脚本 eval"
    echo "  self-update  从 deploy bundle 投放的 wrapper 源自我替换 (CI 在 install 前调用)"
    exit 1
    ;;
esac
