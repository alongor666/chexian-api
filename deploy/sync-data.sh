#!/bin/bash
# ============================================================
# 车险数据分析平台 - 一键数据同步到 VPS
# ============================================================
# 前提：本地 ~/.ssh/config 必须配置 chexian-vps-deploy 别名（见 vps.md）
# 使用方法（在本地 Mac 的 chexian-api 目录执行）：
#   ./deploy/sync-data.sh                     # 自动同步 current/ 下最新文件
#   ./deploy/sync-data.sh 文件路径            # 指定同步某个文件
#   ./deploy/sync-data.sh 文件路径 --no-restart  # 同步但不重启（批量同步中间文件用）
#   ./deploy/sync-data.sh 文件路径 --clean-vps   # 上传前清理 VPS 的 current/ 目录（将旧文件移入 archive）
# ============================================================

set -e

# 配置（通过 ~/.ssh/config 中的 chexian-vps-deploy 别名管理密钥，无需硬编码）
VPS_HOST="chexian-vps-deploy"
VPS_DATA="/var/www/chexian/server/data"
LOCAL_DATA="数据管理/warehouse/fact/policy/current"
VPS_EXPORT_DIR="数据管理/warehouse/vps-export"

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 解析参数
NO_RESTART=false
CLEAN_VPS=false
EXPORT_MODE=false
FILE=""
for arg in "$@"; do
    if [[ "$arg" == "--no-restart" ]]; then
        NO_RESTART=true
    elif [[ "$arg" == "--clean-vps" ]]; then
        CLEAN_VPS=true
    elif [[ "$arg" == "--export" ]]; then
        EXPORT_MODE=true
    elif [[ -z "$FILE" ]]; then
        FILE="$arg"
    fi
done

# 前提检查：验证 SSH 连通性
if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$VPS_HOST" true 2>/dev/null; then
    echo -e "${RED}错误：无法连接 VPS（chexian-vps-deploy）${NC}"
    echo "请检查："
    echo "  1. ~/.ssh/config 是否配置了 chexian-vps-deploy 别名"
    echo "  2. ~/.ssh/chexian_deploy 私钥是否存在"
    echo "  3. VPS authorized_keys 是否包含对应公钥"
    echo ""
    echo "验证命令: ssh chexian-vps-deploy echo ok"
    exit 1
fi

# ============================================================
# 导出模式：运行预聚合导出 → 上传 3 个精简 Parquet
# ============================================================
if [ "$EXPORT_MODE" = true ]; then
    echo -e "${GREEN}[导出模式]${NC} 运行预聚合导出脚本..."
    node scripts/export-for-vps.mjs
    if [ $? -ne 0 ]; then
        echo -e "${RED}错误：导出脚本失败${NC}"
        exit 1
    fi

    echo -e "${YELLOW}  确保 VPS 目录存在...${NC}"
    ssh "$VPS_HOST" "mkdir -p ${VPS_DATA}/current ${VPS_DATA}/archive"

    # 上传 3 个预聚合文件
    for PARQUET_FILE in aggregated.parquet cross_sell_agg.parquet renewal_agg.parquet; do
        LOCAL_FILE="${VPS_EXPORT_DIR}/${PARQUET_FILE}"
        if [ -f "$LOCAL_FILE" ]; then
            SIZE=$(du -h "$LOCAL_FILE" | cut -f1)
            echo -e "${YELLOW}  上传 ${PARQUET_FILE} (${SIZE})...${NC}"
            scp "$LOCAL_FILE" "${VPS_HOST}:${VPS_DATA}/current/"
            ssh "$VPS_HOST" "chmod 600 ${VPS_DATA}/current/${PARQUET_FILE}"
        else
            echo -e "${YELLOW}  跳过 ${PARQUET_FILE}（文件不存在）${NC}"
        fi
    done

    if [ "$NO_RESTART" = true ]; then
        echo -e "${GREEN}✓ 预聚合数据上传完成（跳过重启）${NC}"
    else
        echo -e "${YELLOW}  重启服务...${NC}"
        ssh "$VPS_HOST" "sudo /usr/local/bin/deploy-chexian-api restart"

        echo -e "${YELLOW}  验证中...${NC}"
        sleep 3
        HEALTH=$(ssh "$VPS_HOST" "curl -s http://localhost:3000/health" 2>/dev/null)
        if echo "$HEALTH" | grep -q "success"; then
            echo -e "${GREEN}✓ 预聚合数据同步完成！${NC} VPS 服务运行正常"
        else
            echo -e "${RED}⚠ 上传完成，但健康检查失败，请检查 VPS 日志${NC}"
            echo "  ssh chexian-vps-deploy 'sudo /usr/local/bin/deploy-chexian-api logs 20'"
        fi
    fi
    exit 0
fi

# ============================================================
# 标准模式：上传单个原始 Parquet（兼容旧流程）
# ============================================================

# 确定要同步的文件
if [ -z "$FILE" ]; then
    FILE=$(ls -t ${LOCAL_DATA}/*.parquet 2>/dev/null | head -1)
fi

if [ ! -f "$FILE" ]; then
    # 尝试在 LOCAL_DATA 下查找
    if [ -f "${LOCAL_DATA}/$FILE" ]; then
        FILE="${LOCAL_DATA}/$FILE"
    fi
fi

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
    echo -e "${RED}错误：未找到 Parquet 文件${NC}"
    echo "用法: ./deploy/sync-data.sh [文件路径] [--no-restart]"
    echo "      ./deploy/sync-data.sh --export    # 预聚合模式（推荐）"
    exit 1
fi

BASENAME=$(basename "$FILE")
SIZE=$(du -h "$FILE" | cut -f1)

echo -e "${GREEN}[同步]${NC} $BASENAME ($SIZE)"

# 确保 VPS 上 current/ 和 archive/ 目录存在
ssh "$VPS_HOST" "mkdir -p ${VPS_DATA}/current ${VPS_DATA}/archive"

# 如果指定了 --clean-vps，则把 current/ 中原有的 .parquet 移入 archive 带时间戳夹里
if [ "$CLEAN_VPS" = true ]; then
    echo -e "${YELLOW}  清理 VPS 的 current 目录...${NC}"
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    # 若有 .parquet 则移动，忽略找不到文件的报错
    ssh "$VPS_HOST" "mkdir -p ${VPS_DATA}/archive/backup_${TIMESTAMP} && mv ${VPS_DATA}/current/*.parquet ${VPS_DATA}/archive/backup_${TIMESTAMP}/ 2>/dev/null || true"
fi

# 上传到 VPS 的 current/ 目录
echo -e "${YELLOW}  上传中...${NC}"
scp "$FILE" "${VPS_HOST}:${VPS_DATA}/current/"

# 设权限
ssh "$VPS_HOST" "chmod 600 ${VPS_DATA}/current/$(printf '%q' "$BASENAME")"

if [ "$NO_RESTART" = true ]; then
    echo -e "${GREEN}✓ 上传完成（跳过重启）${NC}"
else
    # 重启 + 验证
    echo -e "${YELLOW}  重启服务...${NC}"
    ssh "$VPS_HOST" "sudo /usr/local/bin/deploy-chexian-api restart"

    echo -e "${YELLOW}  验证中...${NC}"
    sleep 3
    HEALTH=$(ssh "$VPS_HOST" "curl -s http://localhost:3000/health" 2>/dev/null)
    if echo "$HEALTH" | grep -q "success"; then
        echo -e "${GREEN}✓ 同步完成！${NC} 服务运行正常"
    else
        echo -e "${RED}⚠ 上传完成，但健康检查失败，请检查 VPS 日志${NC}"
        echo "  ssh chexian-vps-deploy 'sudo /usr/local/bin/deploy-chexian-api logs 20'"
    fi
fi
