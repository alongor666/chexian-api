#!/bin/bash
# ============================================================
# 车险数据分析平台 - 一键数据同步到 VPS
# ============================================================
# 使用方法（在本地 Mac 的 chexian-api 目录执行）：
#   ./deploy/sync-data.sh          # 自动同步最新 Parquet 文件
#   ./deploy/sync-data.sh 文件名   # 指定同步某个文件
# ============================================================

set -e

# 配置
VPS_HOST="root@162.14.113.44"
VPS_DATA="/var/www/chexian/server/data"
SSH_KEY="$HOME/.ssh/id_ed25519"
LOCAL_DATA="数据管理/warehouse/fact/policy"

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

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
scp -i "$SSH_KEY" "$FILE" "${VPS_HOST}:${VPS_DATA}/"

# 设权限 + 重启
echo -e "${YELLOW}  重启服务...${NC}"
ssh -i "$SSH_KEY" "$VPS_HOST" "chmod 600 ${VPS_DATA}/$(printf '%q' "$BASENAME") && source /root/.nvm/nvm.sh && pm2 restart chexian-api"

# 验证
echo -e "${YELLOW}  验证中...${NC}"
sleep 3
HEALTH=$(ssh -i "$SSH_KEY" "$VPS_HOST" "curl -s http://localhost:3000/health" 2>/dev/null)
if echo "$HEALTH" | grep -q "success"; then
    echo -e "${GREEN}✓ 同步完成！${NC} 服务运行正常"
else
    echo -e "${RED}⚠ 上传完成，但健康检查失败，请检查 VPS 日志${NC}"
    echo "  ssh -i $SSH_KEY $VPS_HOST 'source /root/.nvm/nvm.sh && pm2 logs chexian-api --lines 20'"
fi
