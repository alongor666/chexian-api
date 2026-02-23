#!/bin/bash
# ============================================================
# 车险数据分析平台 - 一键数据同步到 VPS
# ============================================================
# 前提：本地 ~/.ssh/config 必须配置 chexian-vps 别名（见 vps.md）
# 使用方法（在本地 Mac 的 chexian-api 目录执行）：
#   ./deploy/sync-data.sh          # 自动同步最新 Parquet 文件
#   ./deploy/sync-data.sh 文件名   # 指定同步某个文件
# ============================================================

set -e

# 配置（通过 ~/.ssh/config 中的 chexian-vps 别名管理密钥，无需硬编码）
VPS_HOST="chexian-vps"
VPS_DATA="/var/www/chexian/server/data"
LOCAL_DATA="数据管理/warehouse/fact/policy"

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 前提检查：验证 SSH 连通性
if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$VPS_HOST" true 2>/dev/null; then
    echo -e "${RED}错误：无法连接 VPS（chexian-vps）${NC}"
    echo "请检查："
    echo "  1. ~/.ssh/config 是否配置了 chexian-vps 别名"
    echo "  2. ~/.ssh/chexian_deploy 私钥是否存在"
    echo "  3. VPS authorized_keys 是否包含对应公钥"
    echo ""
    echo "验证命令: ssh chexian-vps echo ok"
    exit 1
fi

# 确定要同步的文件
if [ -n "$1" ]; then
    FILE="$1"
    if [ ! -f "$FILE" ]; then
        FILE="${LOCAL_DATA}/$1"
    fi
else
    FILE=$(ls -t ${LOCAL_DATA}/*.parquet 2>/dev/null | head -1)
fi

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
    echo -e "${RED}错误：未找到 Parquet 文件${NC}"
    echo "用法: ./deploy/sync-data.sh [文件路径]"
    exit 1
fi

BASENAME=$(basename "$FILE")
SIZE=$(du -h "$FILE" | cut -f1)

echo -e "${GREEN}[同步]${NC} $BASENAME ($SIZE)"

# 上传
echo -e "${YELLOW}  上传中...${NC}"
scp "$FILE" "${VPS_HOST}:${VPS_DATA}/"

# 设权限 + 重启
echo -e "${YELLOW}  重启服务...${NC}"
ssh "$VPS_HOST" "chmod 600 ${VPS_DATA}/$(printf '%q' "$BASENAME") && source /root/.nvm/nvm.sh && pm2 restart chexian-api"

# 验证
echo -e "${YELLOW}  验证中...${NC}"
sleep 3
HEALTH=$(ssh "$VPS_HOST" "curl -s http://localhost:3000/health" 2>/dev/null)
if echo "$HEALTH" | grep -q "success"; then
    echo -e "${GREEN}✓ 同步完成！${NC} 服务运行正常"
else
    echo -e "${RED}⚠ 上传完成，但健康检查失败，请检查 VPS 日志${NC}"
    echo "  ssh chexian-vps 'source /root/.nvm/nvm.sh && pm2 logs chexian-api --lines 20'"
fi
