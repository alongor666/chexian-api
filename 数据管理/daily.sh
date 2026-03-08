#!/bin/bash
# 每日一键 ETL：单清单模式，零参数运行
#
# 源文件命名规范：
#   续保业务类型匹配更新至YYYY年M月.xlsx
#   每日数据_20231101_YYYYMMDD.xlsx
#
# 输出目录结构：
#   warehouse/fact/policy/current/   ← 服务器只加载此目录（单个活跃文件）
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

OLD_24_26=$(ls -1 "$CURRENT_DIR"/车险24-26年清单_*.parquet 2>/dev/null || true)
if [[ -n "$OLD_24_26" ]]; then
    echo -e "${YELLOW}📦 发现旧命名格式文件，迁移到 archive/${NC}"
    for f in $OLD_24_26; do
        mv "$f" "$ARCHIVE_DIR/"
        echo "   → $(basename "$f")"
    done
    echo ""
fi

# ============================================================
# 1. 找续保源文件（续保业务类型匹配*.xlsx / 续保类型匹配*.xlsx）
# ============================================================
SOURCE_XLSX=$(ls -1 续保业务类型匹配*.xlsx 续保类型匹配*.xlsx 2>/dev/null | sort -r | head -1)
if [[ -n "$SOURCE_XLSX" ]]; then
    echo -e "${GREEN}续保源文件: $SOURCE_XLSX${NC}"
else
    echo -e "${YELLOW}⚠ 未找到续保源文件，将跳过续保业务类型匹配${NC}"
fi

# ============================================================
# 2. 找每日数据文件（每日数据_*.xlsx）
# ============================================================
POLICY_XLSX=$(ls -1 每日数据_*.xlsx 2>/dev/null | sort -r | head -1)
if [[ -n "$POLICY_XLSX" ]]; then
    POLICY_BASENAME="${POLICY_XLSX%.xlsx}"
    POLICY_OUTPUT="$CURRENT_DIR/${POLICY_BASENAME}.parquet"
    echo -e "${GREEN}每日数据: $POLICY_XLSX → $(basename "$POLICY_OUTPUT")${NC}"
else
    echo -e "${RED}❌ 未找到每日数据文件（每日数据_*.xlsx）${NC}"
    exit 1
fi

echo ""

# ============================================================
# 3. 归档 current/ 下旧的同类文件（避免重复）
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

archive_old "每日数据" "$POLICY_OUTPUT"

echo ""

# ============================================================
# 4. 执行单清单转换
# ============================================================
echo -e "${GREEN}▶ 步骤 1/1: 单清单数据转换${NC}"
if [[ -n "$SOURCE_XLSX" ]]; then
    ./run.sh full --source "$SOURCE_XLSX" --target "$POLICY_XLSX" --output "$POLICY_OUTPUT" --no-sync
else
    ./run.sh full --target "$POLICY_XLSX" --output "$POLICY_OUTPUT" --no-sync
fi

echo ""

# ============================================================
# 5. 运行本地预聚合 (export-for-vps.mjs)
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
# 6. 同步 current/ 下所有基础明细 parquet 以及 vps-export/ 下的预聚合 parquet 到 VPS
# ============================================================
SYNC_SCRIPT="$(dirname "$SCRIPT_DIR")/deploy/sync-data.sh"
VPS_HOST="chexian-vps-deploy"

if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$VPS_HOST" true 2>/dev/null; then
    echo -e "${RED}❌ 无法连接 VPS（${VPS_HOST}），终止同步${NC}"
    echo "建议先执行：bash scripts/setup-local-env.sh"
    echo "验证命令：ssh ${VPS_HOST} echo ok"
    exit 1
fi

shopt -s nullglob
PARQUET_FILES=("$CURRENT_DIR"/*.parquet)
if [[ -d "warehouse/vps-export" ]]; then
    PARQUET_FILES+=("warehouse/vps-export"/*.parquet)
fi
shopt -u nullglob

if [[ ${#PARQUET_FILES[@]} -eq 0 ]]; then
    echo -e "${RED}❌ 未找到可同步的 Parquet 文件，终止同步${NC}"
    exit 1
fi

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
