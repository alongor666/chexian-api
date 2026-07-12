#!/bin/sh
# 数据新鲜度心跳看门狗（BACKLOG 2026-07-12-claude-47f8ce · 审计FIND-001）
#
# 部署位置：chexian 生产 VPS（与 Mac 发布链故障域隔离的 dead-man's-switch，中文：断人开关/心跳看门狗）。
# 原理：发布链每天经 rsync 更新 /var/www/chexian/server/data 下的 parquet；
#       若数据目录最新文件修改时间距现在超过阈值（默认 30 小时 ≈ 每日节奏 + 余量），
#       说明"今天没发布成功且没人处理"——独立于 Mac 的告警通道直接推群。
#       刻意不依赖 :3000 API（App 挂了也要能报），只看磁盘事实。
# 反骚扰：告警后 12 小时内不重复；恢复新鲜后推一条恢复通知并复位。
#
# 配置（/etc/chexian/watchdog.env，600 权限，真实 webhook 不进 git）：
#   WATCHDOG_WEBHOOK_URL   必填。企微/飞书群机器人 webhook 地址
#   WATCHDOG_WEBHOOK_KIND  wecom（默认）| feishu
#   WATCHDOG_DATA_DIRS     监控目录，空格分隔（默认见下）
#   WATCHDOG_STALE_HOURS   新鲜度阈值小时（默认 30）
#   WATCHDOG_REALERT_HOURS 重复告警间隔小时（默认 12）
#   WATCHDOG_STATE_DIR     状态目录（默认 /var/lib/chexian-watchdog）
#   WATCHDOG_DRY_RUN       置 1 时只打印不发 webhook（本地测试用）
#
# 建议 crontab（root）：*/30 * * * * sh /usr/local/bin/data-freshness-watchdog.sh >> /var/log/chexian-watchdog.log 2>&1
set -eu

ENV_FILE="${WATCHDOG_ENV_FILE:-/etc/chexian/watchdog.env}"
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

WEBHOOK_URL="${WATCHDOG_WEBHOOK_URL:-}"
KIND="${WATCHDOG_WEBHOOK_KIND:-wecom}"
DATA_DIRS="${WATCHDOG_DATA_DIRS:-/var/www/chexian/server/data/current /var/www/chexian/server/data/fact /var/www/chexian/server/data/validation}"
STALE_HOURS="${WATCHDOG_STALE_HOURS:-30}"
REALERT_HOURS="${WATCHDOG_REALERT_HOURS:-12}"
STATE_DIR="${WATCHDOG_STATE_DIR:-/var/lib/chexian-watchdog}"
DRY_RUN="${WATCHDOG_DRY_RUN:-0}"

if [ -z "$WEBHOOK_URL" ] && [ "$DRY_RUN" != "1" ]; then
  echo "[watchdog] ❌ 未配置 WATCHDOG_WEBHOOK_URL（$ENV_FILE），拒绝静默运行"; exit 3
fi
mkdir -p "$STATE_DIR"
ALERT_STAMP="$STATE_DIR/last-alert-epoch"

# 最新文件修改时间（epoch 秒）。GNU find 优先，macOS(BSD) 回退 stat -f（本地 dry-run 测试用）
newest_epoch() {
  # shellcheck disable=SC2086
  N=$(find $DATA_DIRS -type f -printf '%T@\n' 2>/dev/null | cut -d. -f1 | sort -rn | head -1 || true)
  if [ -z "$N" ]; then
    # shellcheck disable=SC2086
    N=$(find $DATA_DIRS -type f -exec stat -f %m {} + 2>/dev/null | sort -rn | head -1 || true)
  fi
  echo "${N:-0}"
}

send_msg() {
  TEXT="$1"
  if [ "$DRY_RUN" = "1" ]; then echo "[watchdog][dry-run] $TEXT"; return 0; fi
  if [ "$KIND" = "feishu" ]; then
    BODY=$(printf '{"msg_type":"text","content":{"text":"%s"}}' "$TEXT")
  else
    BODY=$(printf '{"msgtype":"text","text":{"content":"%s"}}' "$TEXT")
  fi
  curl -sS --max-time 10 -H 'Content-Type: application/json' -d "$BODY" "$WEBHOOK_URL" >/dev/null \
    || echo "[watchdog] ⚠ webhook 发送失败（不中止，下轮重试）"
}

NOW=$(date +%s)
NEWEST=$(newest_epoch)
if [ "$NEWEST" -eq 0 ]; then
  echo "[watchdog] ❌ 监控目录无文件或不可读：$DATA_DIRS"
  send_msg "【车险数据看门狗】异常：监控目录无文件或不可读（$DATA_DIRS），请立即检查 VPS 数据目录。"
  exit 4
fi
AGE_H=$(( (NOW - NEWEST) / 3600 ))
BEIJING_NEWEST=$(TZ=Asia/Shanghai date -d "@$NEWEST" '+%m-%d %H:%M' 2>/dev/null || TZ=Asia/Shanghai date -r "$NEWEST" '+%m-%d %H:%M')

if [ "$AGE_H" -lt "$STALE_HOURS" ]; then
  if [ -f "$ALERT_STAMP" ]; then
    send_msg "【车险数据看门狗】✅ 已恢复：数据于北京时间 $BEIJING_NEWEST 更新（距今 ${AGE_H}h）。"
    rm -f "$ALERT_STAMP"
  fi
  echo "[watchdog] ✅ 新鲜（最新更新：北京 $BEIJING_NEWEST，距今 ${AGE_H}h < ${STALE_HOURS}h）"
  exit 0
fi

LAST_ALERT=$(cat "$ALERT_STAMP" 2>/dev/null || echo 0)
if [ $(( NOW - LAST_ALERT )) -lt $(( REALERT_HOURS * 3600 )) ]; then
  echo "[watchdog] 🔴 仍陈旧（${AGE_H}h），距上次告警未满 ${REALERT_HOURS}h，本轮静默"
  exit 0
fi
send_msg "【车险数据看门狗】🔴 生产数据已 ${AGE_H} 小时未更新（最后更新：北京 $BEIJING_NEWEST，阈值 ${STALE_HOURS}h）。发布链可能静默中断（Mac 离线/发布失败），请检查 auto-release 状态与日志。"
echo "$NOW" > "$ALERT_STAMP"
echo "[watchdog] 🔴 已告警（数据 ${AGE_H}h 未更新）"
