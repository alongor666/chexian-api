#!/bin/bash
# 每日一键 ETL：双清单模式（历史 + 每日），零参数运行
#
# 源文件命名规范：
#   续保类型匹配至*.xlsx            ← --source（续保匹配库）
#   车险2024年清单更新至YYYYMMDD.xlsx  ← 历史数据（2023-11 ~ 2024-12）
#   车险2526年清单更新至YYYYMMDD.xlsx  ← 每日数据（2025-01 ~ 今）
#
# 输出目录结构：
#   warehouse/fact/policy/current/   ← 服务器只加载此目录（≤2 个活跃文件）
#   warehouse/fact/policy/archive/   ← 旧文件归档，不加载

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

CURRENT_DIR="warehouse/fact/policy/current"
ARCHIVE_DIR="warehouse/fact/policy/archive"
mkdir -p "$CURRENT_DIR" "$ARCHIVE_DIR"

# ============================================================
# 0. 首次运行迁移：将旧格式文件（车险保单综合明细表*.parquet）移入 archive/
# ============================================================
OLD_FILES=$(ls -1 warehouse/fact/policy/车险保单综合明细表*.parquet 2>/dev/null || true)
if [[ -n "$OLD_FILES" ]]; then
    echo -e "${YELLOW}📦 发现旧格式文件，迁移到 archive/${NC}"
    for f in $OLD_FILES; do
        mv "$f" "$ARCHIVE_DIR/"
        echo "   → $(basename "$f")"
    done
    echo ""
fi

# ============================================================
# 1. 找续保源文件（--source 通用）
# ============================================================
SOURCE=$(ls -1 续保类型匹配*.xlsx 2>/dev/null | sort -r | head -1)
if [[ -z "$SOURCE" ]]; then
    echo -e "${RED}❌ 未找到续保源文件: 续保类型匹配*.xlsx${NC}"
    exit 1
fi
echo -e "${GREEN}续保源文件: $SOURCE${NC}"

# ============================================================
# 2. 找历史清单文件（车险2024年清单更新至*.xlsx）
# ============================================================
HIST_XLSX=$(ls -1 车险2024年清单更新至*.xlsx 2>/dev/null | sort -r | head -1)
if [[ -n "$HIST_XLSX" ]]; then
    HIST_DATE=$(echo "$HIST_XLSX" | grep -oE '[0-9]{8}' | tail -1)
    HIST_OUTPUT="$CURRENT_DIR/历史数据_20231101_20241231.parquet"
    echo -e "${GREEN}历史清单: $HIST_XLSX → $(basename $HIST_OUTPUT)${NC}"
else
    echo -e "${YELLOW}⚠ 未找到历史清单（车险2024年清单更新至*.xlsx），跳过历史文件生成${NC}"
fi

# ============================================================
# 3. 找每日清单文件（车险2526年清单更新至*.xlsx）
# ============================================================
DAILY_XLSX=$(ls -1 车险2526年清单更新至*.xlsx 2>/dev/null | sort -r | head -1)
if [[ -n "$DAILY_XLSX" ]]; then
    DAILY_DATE=$(echo "$DAILY_XLSX" | grep -oE '[0-9]{8}' | tail -1)
    DAILY_OUTPUT="$CURRENT_DIR/每日数据_20250101_${DAILY_DATE}.parquet"
    echo -e "${GREEN}每日清单: $DAILY_XLSX → $(basename $DAILY_OUTPUT)${NC}"
else
    echo -e "${RED}❌ 未找到每日清单（车险2526年清单更新至*.xlsx）${NC}"
    exit 1
fi

echo ""

# ============================================================
# 4. 归档 current/ 下旧的同类文件（避免重复）
# ============================================================
archive_old() {
    local PREFIX="$1"   # e.g. "历史数据" or "每日数据"
    local NEW_FILE="$2" # e.g. "历史数据_20231101_20241231.parquet"
    for OLD in "$CURRENT_DIR"/${PREFIX}_*.parquet; do
        [[ -f "$OLD" ]] || continue
        [[ "$OLD" == "$NEW_FILE" ]] && continue
        OLD_BASE=$(basename "${OLD%.parquet}")
        mv "$OLD" "$ARCHIVE_DIR/${OLD_BASE}_$(date +%Y%m%d).parquet"
        echo -e "${YELLOW}📦 归档: $(basename "$OLD") → archive/${OLD_BASE}_$(date +%Y%m%d).parquet${NC}"
    done
}

archive_old "历史数据" "$HIST_OUTPUT"
archive_old "每日数据" "$DAILY_OUTPUT"

echo ""

# ============================================================
# 5. 执行历史文件转换（如有）
# ============================================================
if [[ -n "$HIST_XLSX" ]]; then
    echo -e "${GREEN}▶ 步骤 1/2: 历史数据转换${NC}"
    ./run.sh full --source "$SOURCE" --target "$HIST_XLSX" --output "$HIST_OUTPUT" --no-sync
    echo ""
fi

# ============================================================
# 6. 执行每日文件转换
# ============================================================
echo -e "${GREEN}▶ 步骤 2/2: 每日数据转换${NC}"
./run.sh full --source "$SOURCE" --target "$DAILY_XLSX" --output "$DAILY_OUTPUT" --no-sync

echo ""

# ============================================================
# 7. 运行本地预聚合 (export-for-vps.mjs)
# 确保在上传之前在本地计算好所有聚合数据，防止 VPS 资源爆炸及数据不一致
# ============================================================
EXPORT_SCRIPT="$(dirname "$SCRIPT_DIR")/scripts/export-for-vps.mjs"
if [[ -f "$EXPORT_SCRIPT" ]]; then
    echo -e "${GREEN}▶ 步骤 3: 运行预聚合数据导出...${NC}"
    (cd "$(dirname "$SCRIPT_DIR")" && node scripts/export-for-vps.mjs)
    echo ""
else
    echo -e "${YELLOW}⚠ 未找到 scripts/export-for-vps.mjs，跳过预聚合导出${NC}"
    echo ""
fi

# ============================================================
# 8. 同步 current/ 下所有基础明细 parquet 以及 vps-export/ 下的预聚合 parquet 到 VPS
# ============================================================
SYNC_SCRIPT="$(dirname "$SCRIPT_DIR")/deploy/sync-data.sh"
# 收集全量明细数据，以及刚才生成的预聚合数据
PARQUET_FILES=("$CURRENT_DIR"/*.parquet "warehouse/vps-export"/*.parquet)

echo -e "${GREEN}📦 同步 ${#PARQUET_FILES[@]} 个文件到 VPS${NC}"
for f in "${PARQUET_FILES[@]}"; do
    echo "   $(basename "$f")  ($(du -h "$f" | cut -f1))"
done
echo ""

if [[ -f "$SYNC_SCRIPT" ]]; then
    LAST_IDX=$((${#PARQUET_FILES[@]} - 1))
    for i in "${!PARQUET_FILES[@]}"; do
        # 决定是否清理 VPS（只有第一个文件上传时需要清理一次）
        CLEAN_FLAG=""
        if [[ $i -eq 0 ]]; then
            CLEAN_FLAG="--clean-vps"
        fi
        
        # 决定是否重启（只有最后一个文件上传完才重启）
        RESTART_FLAG=""
        if [[ $i -ne $LAST_IDX ]]; then
            RESTART_FLAG="--no-restart"
        fi
        
        bash "$SYNC_SCRIPT" "${PARQUET_FILES[$i]}" $CLEAN_FLAG $RESTART_FLAG
    done
    echo ""
    echo -e "${GREEN}✅ 全部同步完成，服务器已重启并仅加载了最新的文件${NC}"
else
    echo -e "${YELLOW}⚠ 未找到 sync-data.sh，请手动同步${NC}"
    for f in "${PARQUET_FILES[@]}"; do
        echo "  ./deploy/sync-data.sh $f"
    done
fi
