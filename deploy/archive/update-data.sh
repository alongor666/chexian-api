#!/bin/bash
# ============================================================
# 车险业务分析系统 - 数据更新脚本
# ============================================================
# 使用方法:
#   ./update-data.sh /path/to/new-data.parquet
#   ./update-data.sh /path/to/new-data.parquet --backup
# ============================================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 配置
DATA_DIR="/var/www/chexian/shared-data"
TARGET_FILE="$DATA_DIR/业务数据.parquet"
BACKUP_DIR="$DATA_DIR/backups"

# 参数检查
if [ -z "$1" ]; then
    log_error "请指定数据文件路径"
    echo ""
    echo "使用方法: $0 /path/to/data.parquet [--backup]"
    exit 1
fi

SOURCE_FILE="$1"
DO_BACKUP="$2"

# 检查源文件
if [ ! -f "$SOURCE_FILE" ]; then
    log_error "文件不存在: $SOURCE_FILE"
    exit 1
fi

# 检查文件扩展名
if [[ ! "$SOURCE_FILE" == *.parquet ]]; then
    log_warn "文件扩展名不是 .parquet，继续执行？(y/n)"
    read -r CONTINUE
    if [ "$CONTINUE" != "y" ]; then
        exit 0
    fi
fi

# 创建数据目录（如果不存在）
if [ ! -d "$DATA_DIR" ]; then
    log_info "创建数据目录..."
    sudo mkdir -p "$DATA_DIR"
    sudo chown $(whoami):$(whoami) "$DATA_DIR"
fi

# 备份旧数据（可选）
if [ "$DO_BACKUP" == "--backup" ] && [ -f "$TARGET_FILE" ]; then
    log_info "备份旧数据..."
    mkdir -p "$BACKUP_DIR"
    BACKUP_FILE="$BACKUP_DIR/业务数据.$(date +%Y%m%d_%H%M%S).parquet"
    cp "$TARGET_FILE" "$BACKUP_FILE"
    log_success "备份完成: $BACKUP_FILE"
fi

# 复制新数据
log_info "更新数据文件..."
cp "$SOURCE_FILE" "$TARGET_FILE"

# 显示文件信息
FILE_SIZE=$(ls -lh "$TARGET_FILE" | awk '{print $5}')
log_success "数据更新完成！"
echo ""
echo "文件路径: $TARGET_FILE"
echo "文件大小: $FILE_SIZE"
echo "更新时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""
echo "用户刷新浏览器即可看到新数据"
