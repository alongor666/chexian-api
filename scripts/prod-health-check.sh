#!/usr/bin/env bash
# ============================================================
# 生产环境全站 API 巡检脚本
# ============================================================
#
# 功能：并行 curl 所有 /api/query/* 端点，输出健康状态报告
#
# 使用方式：
#   1. 设置环境变量（二选一）：
#      a) 导出变量：  export HEALTH_CHECK_USER=admin HEALTH_CHECK_PASS=yourpass
#      b) 写入文件：  cp .env.health-check.example .env.health-check && 编辑填入凭据
#   2. 运行：  bash scripts/prod-health-check.sh
#   3. 可选参数：
#      --url <BASE_URL>   指定目标（默认 https://chexian.cretvalu.com）
#      --year <YEAR>      指定查询年份（默认 2025）
#      --verbose          显示失败端点的完整错误信息
#   4. 看输出：✅=正常  ⚠️=慢(>3s)  ❌=异常
#   5. 退出码：echo $?  →  0=全通过  1=有失败  2=认证失败
#
# 依赖：curl, jq（macOS 自带或 brew install jq）
# ============================================================

set -euo pipefail

# ---- 参数解析 ----
BASE_URL="https://chexian.cretvalu.com"
YEAR="2025"
VERBOSE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)    BASE_URL="$2"; shift 2 ;;
    --year)   YEAR="$2"; shift 2 ;;
    --verbose) VERBOSE=true; shift ;;
    -h|--help)
      head -20 "$0" | tail -18
      exit 0 ;;
    *) echo "未知参数: $1（用 --help 查看帮助）"; exit 1 ;;
  esac
done

# ---- 凭据加载 ----
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env.health-check"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$ENV_FILE"
fi

HEALTH_CHECK_USER="${HEALTH_CHECK_USER:-}"
HEALTH_CHECK_PASS="${HEALTH_CHECK_PASS:-}"

if [[ -z "$HEALTH_CHECK_USER" || -z "$HEALTH_CHECK_PASS" ]]; then
  echo "❌ 缺少凭据。请设置环境变量或创建 .env.health-check 文件："
  echo "   export HEALTH_CHECK_USER=admin HEALTH_CHECK_PASS=yourpass"
  echo "   或: cp .env.health-check.example .env.health-check && vim .env.health-check"
  exit 2
fi

# ---- 前置检查 ----
for cmd in curl jq; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "❌ 缺少依赖: $cmd（macOS: brew install $cmd）"
    exit 2
  fi
done

# ---- 动态提取路由表 ----
# 从 server/src/routes/query/*.ts 中 grep 出所有 router.get('...') 的路径
ROUTE_DIR="$PROJECT_DIR/server/src/routes/query"
if [[ -d "$ROUTE_DIR" ]]; then
  ROUTES=$(grep -rh "router\.get(" "$ROUTE_DIR" | \
    grep -oE "'/[^']+'" | \
    tr -d "'" | \
    sed 's|^/||' | \
    sort -u)
else
  echo "⚠️ 路由目录不存在 ($ROUTE_DIR)，使用内置路由表"
  ROUTES=""
fi

# 内置路由表（兜底 + 补充动态提取可能遗漏的）
BUILTIN_ROUTES="
kpi
kpi-detail
trend
quality-business-trend
growth
cost
coefficient
truck
renewal
renewal-drilldown
cross-sell
cross-sell-trend
cross-sell-summary
cross-sell-org-trend
cross-sell-heatmap
cross-sell-top-salesman
premium-plan
plan-achievement
fee-analysis
performance-summary
performance-trend
performance-drilldown
performance-org-heatmap
performance-top-salesman
salesman-ranking
marketing-report
holiday-drilldown
premium-report
comprehensive-bundle
comprehensive-analysis-bundle
dashboard-bundle
performance-bundle
cross-sell-bundle
renewal-funnel/overview
renewal-funnel/trend
renewal-funnel/team
renewal-funnel/salesman
renewal-funnel/action-list
renewal-funnel/matrix
renewal-funnel/metadata
renewal-funnel/risk
"

# 合并去重
ALL_ROUTES=$(echo -e "$ROUTES\n$BUILTIN_ROUTES" | grep -v '^$' | grep -v '^test$' | sort -u)
ROUTE_COUNT=$(echo "$ALL_ROUTES" | wc -l | tr -d ' ')

# ---- 各端点特殊参数映射 ----
get_params() {
  local route="$1"
  case "$route" in
    cost)
      echo "year=${YEAR}&cutoffDate=${YEAR}-12-31" ;;
    coefficient)
      echo "year=${YEAR}&startDate=${YEAR}-01-01&endDate=${YEAR}-12-31&dateField=policy_date" ;;
    holiday-drilldown)
      echo "year=${YEAR}&groupBy=org_level_3" ;;
    premium-plan)
      echo "year=${YEAR}&level=company" ;;
    *)
      echo "year=${YEAR}" ;;
  esac
}

# ---- 登录获取 Token ----
echo "🔐 登录 ${BASE_URL} ..."
LOGIN_JSON=$(HEALTH_CHECK_USER="$HEALTH_CHECK_USER" HEALTH_CHECK_PASS="$HEALTH_CHECK_PASS" \
  python3 -c "import json,os; print(json.dumps({'username':os.environ['HEALTH_CHECK_USER'],'password':os.environ['HEALTH_CHECK_PASS']}))")
LOGIN_RESP=$(curl -s --max-time 10 -X POST "${BASE_URL}/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "$LOGIN_JSON" 2>/dev/null)

TOKEN=$(echo "$LOGIN_RESP" | jq -r '.data.token // empty' 2>/dev/null)

if [[ -z "$TOKEN" ]]; then
  echo "❌ 登录失败"
  echo "$LOGIN_RESP" | jq '.error // .' 2>/dev/null || echo "$LOGIN_RESP"
  exit 2
fi
echo "✅ 登录成功（token: ${TOKEN:0:20}...）"

# ---- 健康端点检查 ----
echo ""
echo "🏥 基础健康检查..."
HEALTH_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${BASE_URL}/health")
if [[ "$HEALTH_CODE" == "200" ]]; then
  echo "   /health          → ✅ $HEALTH_CODE"
else
  echo "   /health          → ❌ $HEALTH_CODE（数据可能未加载完，后续结果可能不准）"
fi

FILTER_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
  -H "Authorization: Bearer $TOKEN" "${BASE_URL}/api/filters/options")
echo "   /api/filters/options → $([ "$FILTER_CODE" = "200" ] && echo "✅" || echo "❌") $FILTER_CODE"

# ---- 并行 API 巡检 ----
echo ""
echo "🔍 API 巡检（${ROUTE_COUNT} 个端点，year=${YEAR}）..."
echo ""

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# 并行请求所有端点（用路由名做文件名，避免并行索引冲突）
while IFS= read -r route; do
  [[ -z "$route" ]] && continue
  PARAMS=$(get_params "$route")
  SAFE_NAME=$(echo "$route" | tr '/' '_')
  (
    START_MS=$(python3 -c 'import time; print(int(time.time()*1000))')
    RESP=$(curl -s -w "\n%{http_code}" --max-time 30 \
      -H "Authorization: Bearer $TOKEN" \
      "${BASE_URL}/api/query/${route}?${PARAMS}" 2>/dev/null)
    END_MS=$(python3 -c 'import time; print(int(time.time()*1000))')

    HTTP_CODE=$(echo "$RESP" | tail -1)
    BODY=$(echo "$RESP" | sed '$d')
    ELAPSED=$((END_MS - START_MS))

    DATA_LEN=$(echo "$BODY" | jq '.data | if type == "array" then length elif type == "object" then keys | length else 0 end' 2>/dev/null || echo "0")
    SUCCESS=$(echo "$BODY" | jq -r '.success // "null"' 2>/dev/null)
    ERR_MSG=$(echo "$BODY" | jq -r '.error.message // ""' 2>/dev/null | head -c 80)

    # 判定状态
    if [[ "$HTTP_CODE" == "200" && "$SUCCESS" == "true" ]]; then
      if [[ "$ELAPSED" -gt 3000 ]]; then
        STATUS="SLOW"
      else
        STATUS="PASS"
      fi
    else
      STATUS="FAIL"
    fi

    # 写入临时文件（用路由名做文件名，唯一不冲突）
    echo "${STATUS}|${route}|${HTTP_CODE}|${ELAPSED}|${DATA_LEN}|${ERR_MSG}" > "$TMPDIR/$SAFE_NAME"
  ) &
done <<< "$ALL_ROUTES"
wait

# ---- 输出报告 ----
PASS=0
SLOW=0
FAIL=0

printf "  %-42s  %-4s  %-6s  %-8s  %s\n" "端点" "状态" "结果" "耗时" "数据量"
printf "  %-42s  %-4s  %-6s  %-8s  %s\n" "$(printf '%0.s─' {1..42})" "────" "──────" "────────" "─────"

while IFS= read -r route; do
  [[ -z "$route" ]] && continue
  SAFE_NAME=$(echo "$route" | tr '/' '_')
  if [[ -f "$TMPDIR/$SAFE_NAME" ]]; then
    IFS='|' read -r status ep_name code elapsed data_len err_msg < "$TMPDIR/$SAFE_NAME"
    case "$status" in
      PASS) ICON="✅"; PASS=$((PASS + 1)) ;;
      SLOW) ICON="⚠️"; SLOW=$((SLOW + 1)) ;;
      FAIL) ICON="❌"; FAIL=$((FAIL + 1)) ;;
    esac
    printf "  %-42s  %s  %-2s  %4dms  data:%-4s" "$ep_name" "$code" "$ICON" "$elapsed" "$data_len"
    if [[ "$status" == "FAIL" && "$VERBOSE" == "true" ]]; then
      printf "  %s" "$err_msg"
    fi
    echo ""
  fi
done <<< "$ALL_ROUTES"

# ---- 汇总 ----
TOTAL=$((PASS + SLOW + FAIL))
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  📊 汇总：${TOTAL} 个端点"
echo "     ✅ 正常：${PASS}"
[[ $SLOW -gt 0 ]] && echo "     ⚠️  慢(>3s)：${SLOW}"
[[ $FAIL -gt 0 ]] && echo "     ❌ 异常：${FAIL}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ $FAIL -gt 0 ]]; then
  echo ""
  echo "💡 提示：用 --verbose 查看失败详情"
  exit 1
else
  exit 0
fi
