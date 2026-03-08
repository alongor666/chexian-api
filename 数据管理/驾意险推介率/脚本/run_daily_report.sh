#!/bin/bash
# 驾意险推介率日报生成脚本

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}🚀 开始生成驾意险推介率日报...${NC}"
echo "执行时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# 运行 Python 脚本
python3 daily_report_jiayi.py

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ 日报生成成功！${NC}"
    
    # 发送通知到飞书（可选）
    # 这里可以添加飞书 webhook 通知逻辑
    
else
    echo -e "${RED}❌ 日报生成失败！${NC}"
    exit 1
fi
