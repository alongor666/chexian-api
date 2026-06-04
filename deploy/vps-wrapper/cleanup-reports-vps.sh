#!/usr/bin/env bash
#
# VPS 端 reports 兜底清理脚本（cron 每日运行）
#
# 与 scripts/cleanup-reports.mjs 配套：
#   - mjs（精）：sync-vps 同步前在本地按业务名分组保留最新
#   - 本 bash（粗）：VPS 端兜底，专杀两类大头浪费，防止漏网累积
#       1) 纯时间戳测试文件     (^\d{8}-\d{6}-[a-f0-9]+\.html$)
#       2) 日期格式子目录中的非最新一个 (如 diagnose-loss-development/<YYYY-MM-DD>/)
#
# 部署：
#   sudo cp deploy/vps-wrapper/cleanup-reports-vps.sh /usr/local/bin/cleanup-chexian-reports.sh
#   sudo chmod +x /usr/local/bin/cleanup-chexian-reports.sh
#   sudo crontab -e
#     # 每天凌晨 3:30 清理一次
#     30 3 * * * /usr/local/bin/cleanup-chexian-reports.sh >> /var/log/cleanup-chexian-reports.log 2>&1
#
# 用法：
#   cleanup-chexian-reports.sh                  # 实际清理（cron 默认）
#   cleanup-chexian-reports.sh --dry-run        # 只打印，不删除
#   REPORTS_DIR=/path cleanup-chexian-reports.sh   # 覆盖默认目录

set -euo pipefail

REPORTS_DIR="${REPORTS_DIR:-/var/www/chexian/server/data/reports}"
FRONTEND_REPORTS_DIR="${FRONTEND_REPORTS_DIR:-/var/www/chexian/frontend/dist/reports}"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] $*"; }

do_rm() {
  local target="$1"
  local reason="$2"
  if [[ $DRY_RUN -eq 1 ]]; then
    log "DRY-RUN  ✗ $target  ($reason)"
  else
    rm -rf "$target" && log "REMOVED  ✗ $target  ($reason)" || log "FAILED   ✗ $target"
  fi
}

# ============================================
# 规则 1: 删除纯时间戳测试文件
# ============================================
cleanup_test_files() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0
  log "扫描测试文件: $dir"
  # 匹配 YYYYMMDD-HHMMSS-hash.html
  find "$dir" -maxdepth 1 -type f -name '*.html' 2>/dev/null | while read -r f; do
    local base
    base="$(basename "$f")"
    if [[ "$base" =~ ^[0-9]{8}-[0-9]{6}-[a-f0-9]+\.html$ ]]; then
      do_rm "$f" "纯时间戳测试文件"
    fi
  done
}

# ============================================
# 规则 2: 日期格式子目录只保留最新一个
# ============================================
cleanup_date_subdirs() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0
  log "扫描日期子目录: $dir"
  # 对 dir 下每个一级子目录（如 diagnose-loss-development/）
  find "$dir" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | while read -r sub; do
    # 找出该子目录下的 YYYY-MM-DD 格式二级子目录（兼容 BSD/GNU find）
    local date_dirs
    date_dirs="$(find "$sub" -mindepth 1 -maxdepth 1 -type d 2>/dev/null \
      | awk -F/ '$NF ~ /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/' \
      | sort -r)"
    [[ -z "$date_dirs" ]] && continue
    local count=0
    while IFS= read -r d; do
      count=$((count + 1))
      if [[ $count -eq 1 ]]; then
        log "KEEP     ✓ $d  ($(basename "$sub")/ 最新日期)"
      else
        do_rm "$d" "$(basename "$sub")/ 旧日期快照"
      fi
    done <<< "$date_dirs"
  done
}

main() {
  log "=== Reports 兜底清理开始 (mode=$([ $DRY_RUN -eq 1 ] && echo dry-run || echo apply)) ==="
  for dir in "$REPORTS_DIR" "$FRONTEND_REPORTS_DIR"; do
    if [[ -d "$dir" ]]; then
      log "--- 处理 $dir ---"
      cleanup_test_files "$dir"
      cleanup_date_subdirs "$dir"
    else
      log "⊝ 跳过（不存在）: $dir"
    fi
  done
  log "=== 完成 ==="
}

main "$@"
