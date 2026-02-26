#!/bin/bash
# 每日一键 ETL：自动识别最新文件，零参数运行
# 用法: ./daily.sh [YYYYMMDD]  (不传则自动取最新文件)

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 1. 找最新的目标文件（按文件名日期倒序取第一个）
if [[ -n "$1" ]]; then
    TARGET="车险签单报价数据${1}.xlsx"
else
    TARGET=$(ls -1 车险签单报价数据*.xlsx 2>/dev/null | sort -r | head -1)
fi

if [[ -z "$TARGET" || ! -f "$TARGET" ]]; then
    echo "❌ 未找到目标文件: ${TARGET:-车险签单报价数据*.xlsx}"
    exit 1
fi

# 2. 从文件名提取日期 → MMDD
YYYYMMDD=$(echo "$TARGET" | grep -oE '[0-9]{8}')
MMDD="${YYYYMMDD:4:4}"

# 3. 找最新的续保源文件
SOURCE=$(ls -1 续保类型匹配*.xlsx 2>/dev/null | sort -r | head -1)
if [[ -z "$SOURCE" ]]; then
    echo "❌ 未找到续保源文件: 续保类型匹配*.xlsx"
    exit 1
fi

# 4. 输出路径
OUTPUT="warehouse/fact/policy/车险保单综合明细表${MMDD}.parquet"

echo "📋 每日 ETL"
echo "   源文件: $SOURCE"
echo "   目标:   $TARGET"
echo "   输出:   $OUTPUT"
echo ""

# 5. 执行
./run.sh full --source "$SOURCE" --target "$TARGET" --output "$OUTPUT"
