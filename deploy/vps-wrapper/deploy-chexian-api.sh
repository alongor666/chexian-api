#!/bin/bash
# deploy-chexian-api — deployer 用户受限 PM2 操作 wrapper
# 安装位置: /usr/local/bin/deploy-chexian-api
# 配合 sudoers: deployer ALL=(root) NOPASSWD: /usr/local/bin/deploy-chexian-api
#
# 安全设计:
#   - 子命令白名单，只允许 install/start/restart/reload/stop/status/describe/logs/save
#   - start 仅允许固定 ecosystem 文件路径，防止任意脚本执行
#   - install 仅在 /var/www/chexian/server 下执行，防止目录逃逸
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

# --- 固定常量 ---
APP_DIR="/var/www/chexian/server"
APP_NAME="chexian-api"
ECOSYSTEM="${APP_DIR}/ecosystem.config.cjs"

# 所有二进制均用绝对路径调用，不修改 PATH

# --- 子命令分发 ---
case "${1:-help}" in
  install)
    cd "$APP_DIR" && "$NPM_BIN" install --production
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
  help|*)
    echo "用法: deploy-chexian-api {install|start|restart|reload|stop|status|describe|logs [N]|save}"
    echo ""
    echo "子命令:"
    echo "  install   在 $APP_DIR 执行 npm install --production"
    echo "  start     启动 PM2 进程 (ecosystem.config.cjs)"
    echo "  restart   重启 PM2 进程 (保留环境变量)"
    echo "  reload    删除后重新启动 (重读 ecosystem 配置)"
    echo "  stop      停止 PM2 进程"
    echo "  status    查看 PM2 进程列表"
    echo "  describe  查看进程详情"
    echo "  logs [N]  查看最近 N 行日志 (默认 50)"
    echo "  save      保存 PM2 进程列表 (用于开机自启)"
    exit 1
    ;;
esac
