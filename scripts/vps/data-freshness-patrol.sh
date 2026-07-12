#!/bin/sh
# 数据巡检（数据新鲜度 dead-man's-switch · BACKLOG 2026-07-12-claude-47f8ce · 审计FIND-001）
#
# 部署位置：chexian 生产 VPS（与 Mac 发布链故障域隔离的巡检探针，定时巡查数据是否停更）。
# 原理：发布链每天经 rsync 更新 /var/www/chexian/server/data 下的 parquet；
#       若数据目录最新文件修改时间距现在超过阈值（默认 30 小时 ≈ 每日节奏 + 余量），
#       说明"今天没发布成功且没人处理"——独立于 Mac 的告警通道直接推群。
#       刻意不依赖 :3000 API（App 挂了也要能报），只看磁盘事实。
# 反骚扰：告警后 12 小时内不重复；恢复新鲜后推一条恢复通知并复位。
#
# 通知通道（二选一，与 server notify.ts #1078 同款「修补不拆除」双通道）：
#   A) 飞书应用 API（推荐，无需 webhook）：以应用身份经 tenant_access_token → im/v1/messages
#      直发群（receive_id_type=chat_id）。复用 VPS 已有 FEISHU_APP_ID/SECRET（登录应用 bot 已在
#      目标群，#1078 已证可群发），无需在飞书群里加自定义机器人（飞书已下线该入口）。
#   B) 群机器人 webhook（旧通道，保留兼容）：PATROL_WEBHOOK_URL 非空即走此路。
#
# 配置（/etc/chexian/patrol.env，600 权限，真实凭证不进 git）：
#   —— 通道 A（飞书应用 API）——
#   PATROL_FEISHU_CHAT_ID     目标群 chat_id（oc_ 开头）。走通道 A 时必填
#   PATROL_FEISHU_APP_ID      飞书应用 App ID（可选，缺省回落 FEISHU_APP_ID）
#   PATROL_FEISHU_APP_SECRET  飞书应用 App Secret（可选，缺省回落 FEISHU_APP_SECRET；禁进 git/日志）
#   —— 通道 B（webhook，可选）——
#   PATROL_WEBHOOK_URL        企微/飞书群机器人 webhook 地址（非空即优先走 webhook）
#   PATROL_WEBHOOK_KIND       wecom（默认）| feishu
#   —— 通用 ——
#   PATROL_DATA_DIRS     监控目录，空格分隔（默认见下）
#   PATROL_STALE_HOURS   新鲜度阈值小时（默认 30）
#   PATROL_REALERT_HOURS 重复告警间隔小时（默认 12）
#   PATROL_STATE_DIR     状态目录（默认 /var/lib/chexian-patrol）
#   PATROL_DRY_RUN       置 1 时只打印不发（本地测试用）
#
# 依赖：curl + python3（仅真实发送时用 python3 做 JSON 双编码与 token 解析；dry-run 无依赖）。
# 建议 crontab（root）：*/30 * * * * sh /usr/local/bin/data-freshness-patrol.sh >> /var/log/chexian-patrol.log 2>&1
set -eu

ENV_FILE="${PATROL_ENV_FILE:-/etc/chexian/patrol.env}"
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

WEBHOOK_URL="${PATROL_WEBHOOK_URL:-}"
KIND="${PATROL_WEBHOOK_KIND:-wecom}"
FEISHU_CHAT_ID="${PATROL_FEISHU_CHAT_ID:-}"
FEISHU_APP_ID_EFF="${PATROL_FEISHU_APP_ID:-${FEISHU_APP_ID:-}}"
FEISHU_APP_SECRET_EFF="${PATROL_FEISHU_APP_SECRET:-${FEISHU_APP_SECRET:-}}"
DATA_DIRS="${PATROL_DATA_DIRS:-/var/www/chexian/server/data/current /var/www/chexian/server/data/fact /var/www/chexian/server/data/validation}"
STALE_HOURS="${PATROL_STALE_HOURS:-30}"
REALERT_HOURS="${PATROL_REALERT_HOURS:-12}"
STATE_DIR="${PATROL_STATE_DIR:-/var/lib/chexian-patrol}"
DRY_RUN="${PATROL_DRY_RUN:-0}"

# 通道就绪判定：webhook 非空（通道 B），或 飞书三要素齐全（通道 A）。二者皆缺则拒绝静默运行。
if [ "$DRY_RUN" != "1" ]; then
  if [ -z "$WEBHOOK_URL" ] && { [ -z "$FEISHU_CHAT_ID" ] || [ -z "$FEISHU_APP_ID_EFF" ] || [ -z "$FEISHU_APP_SECRET_EFF" ]; }; then
    echo "[patrol] ❌ 未配置有效通知通道（$ENV_FILE）：需 PATROL_WEBHOOK_URL，或 PATROL_FEISHU_CHAT_ID + 应用凭证（PATROL_FEISHU_APP_ID/SECRET 或回落 FEISHU_APP_ID/SECRET）。拒绝静默运行"; exit 3
  fi
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

# 通道 A：飞书应用 API 直发群（tenant_access_token → im/v1/messages, receive_id_type=chat_id）。
# app_secret 走 env 传给 python3、经 stdin 喂 curl，不进任何命令行 argv（防 ps 泄漏）。
# python3 负责 JSON 双编码（content 是 {"text":...} 的 JSON 字符串）与响应 code 解析。
feishu_app_send() {
  _text="$1"
  if [ -z "$FEISHU_CHAT_ID" ] || [ -z "$FEISHU_APP_ID_EFF" ] || [ -z "$FEISHU_APP_SECRET_EFF" ]; then
    echo "[patrol] ⚠ 飞书应用通道缺 chat_id/app_id/app_secret，发送跳过"; return 1
  fi
  _tok=$(WD_APPID="$FEISHU_APP_ID_EFF" WD_SECRET="$FEISHU_APP_SECRET_EFF" python3 -c 'import os,json,sys;print(json.dumps({"app_id":os.environ["WD_APPID"],"app_secret":os.environ["WD_SECRET"]}))' \
    | curl -sS --max-time 10 -H 'Content-Type: application/json' -d @- \
        'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal' \
    | python3 -c 'import sys,json
try:
  d=json.load(sys.stdin)
except Exception:
  d={}
sys.stdout.write(d.get("tenant_access_token","") if d.get("code")==0 else "")' 2>/dev/null || true)
  if [ -z "$_tok" ]; then echo "[patrol] ⚠ 取 tenant_access_token 失败（不中止，下轮重试）"; return 1; fi
  _code=$(WD_CHAT="$FEISHU_CHAT_ID" WD_TEXT="$_text" python3 -c 'import os,json;print(json.dumps({"receive_id":os.environ["WD_CHAT"],"msg_type":"text","content":json.dumps({"text":os.environ["WD_TEXT"]},ensure_ascii=False)},ensure_ascii=False))' \
    | curl -sS --max-time 10 -X POST -H "Authorization: Bearer $_tok" -H 'Content-Type: application/json' -d @- \
        'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id' \
    | python3 -c 'import sys,json
try:
  d=json.load(sys.stdin)
except Exception:
  d={}
sys.stdout.write(str(d.get("code")))' 2>/dev/null || true)
  if [ "$_code" = "0" ]; then echo "[patrol] ✅ 飞书群消息已发送"; return 0; fi
  echo "[patrol] ⚠ 飞书发送失败 code=$_code（不中止，下轮重试）"; return 1
}

# 把纯文本安全编码进 JSON 字符串（含引号，正确转义换行/引号/反斜杠），供 webhook 通道拼接。
json_quote() { WD_S="$1" python3 -c 'import os,json,sys;sys.stdout.write(json.dumps(os.environ["WD_S"],ensure_ascii=False))'; }

send_msg() {
  TEXT="$1"
  if [ "$DRY_RUN" = "1" ]; then printf '[patrol][dry-run]\n%s\n' "$TEXT"; return 0; fi
  if [ -n "$WEBHOOK_URL" ]; then
    # 通道 B：群机器人 webhook（旧通道，非空即优先）。经 json_quote 转义，多行文案亦为合法 JSON。
    _q=$(json_quote "$TEXT")
    if [ "$KIND" = "feishu" ]; then
      BODY='{"msg_type":"text","content":{"text":'"$_q"'}}'
    else
      BODY='{"msgtype":"text","text":{"content":'"$_q"'}}'
    fi
    curl -sS --max-time 10 -H 'Content-Type: application/json' -d "$BODY" "$WEBHOOK_URL" >/dev/null \
      || echo "[patrol] ⚠ webhook 发送失败（不中止，下轮重试）"
  else
    # 通道 A：飞书应用 API
    feishu_app_send "$TEXT" || true
  fi
}

# 多行文案换行符（POSIX sh 无 $'\n'，用字面换行的变量）
NL='
'

NOW=$(date +%s)
NEWEST=$(newest_epoch)
if [ "$NEWEST" -eq 0 ]; then
  echo "[patrol] ❌ 监控目录无文件或不可读：$DATA_DIRS"
  send_msg "🔴 车险数据目录异常${NL}${NL}发现　监控目录无文件或不可读（疑似磁盘故障 / 误删 / 权限变更）${NL}安排　AI 值守 / 人工（此类非发布链问题，自动接手不覆盖）${NL}做什么　核查数据目录完整性，从备份恢复${NL}怎么做　登录 VPS 查 /var/www/chexian/server/data，比对 warehouse 备份恢复"
  exit 4
fi
AGE_H=$(( (NOW - NEWEST) / 3600 ))
BEIJING_NEWEST=$(TZ=Asia/Shanghai date -d "@$NEWEST" '+%m-%d %H:%M' 2>/dev/null || TZ=Asia/Shanghai date -r "$NEWEST" '+%m-%d %H:%M')

if [ "$AGE_H" -lt "$STALE_HOURS" ]; then
  if [ -f "$ALERT_STAMP" ]; then
    send_msg "🟢 车险数据已恢复${NL}${NL}发现　数据于 ${BEIJING_NEWEST}（北京）恢复更新${NL}结果　停更已解除，无需处理"
    rm -f "$ALERT_STAMP"
  fi
  echo "[patrol] ✅ 新鲜（最新更新：北京 $BEIJING_NEWEST，距今 ${AGE_H}h < ${STALE_HOURS}h）"
  exit 0
fi

LAST_ALERT=$(cat "$ALERT_STAMP" 2>/dev/null || echo 0)
if [ $(( NOW - LAST_ALERT )) -lt $(( REALERT_HOURS * 3600 )) ]; then
  echo "[patrol] 🔴 仍陈旧（${AGE_H}h），距上次告警未满 ${REALERT_HOURS}h，本轮静默"
  exit 0
fi
send_msg "🔴 车险数据停更 ${AGE_H} 小时${NL}${NL}发现　数据已 ${AGE_H} 小时未更新，最后 ${BEIJING_NEWEST}（北京），超 ${STALE_HOURS}h 阈值${NL}安排　Mac 侧自动接手（auto-remediate）${NL}做什么　轻风险自处置重跑补发，重风险回帖群待确认${NL}怎么做　自动重跑 release:daily；仍失败则诊断原因回帖，重风险动作等人工确认"
echo "$NOW" > "$ALERT_STAMP"
echo "[patrol] 🔴 已告警（数据 ${AGE_H}h 未更新）"
