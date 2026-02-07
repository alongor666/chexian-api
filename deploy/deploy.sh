#!/bin/bash
# ============================================================
# 车险业务分析系统 - 一键部署脚本
# ============================================================
# 使用方法:
#   ./deploy.sh                    # 部署到默认目录
#   ./deploy.sh /custom/path       # 部署到指定目录
#   ./deploy.sh --local            # 本地预览模式
# ============================================================

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 默认配置
DEPLOY_DIR="${1:-/var/www/chexian}"
DATA_DIR="$DEPLOY_DIR/shared-data"
NGINX_CONF="/etc/nginx/sites-available/chexian"

# 检查是否为本地预览模式
if [ "$1" == "--local" ]; then
    log_info "本地预览模式"
    cd "$PROJECT_ROOT"
    bun run build
    log_success "构建完成，使用以下命令预览："
    echo ""
    echo "  cd $PROJECT_ROOT && bun run preview"
    echo ""
    exit 0
fi

# ============================================================
# 步骤 1: 检查依赖
# ============================================================
log_info "检查依赖..."

if ! command -v bun &> /dev/null; then
    log_error "未找到 bun，请先安装: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

# ============================================================
# 步骤 2: 构建项目
# ============================================================
log_info "构建项目..."
cd "$PROJECT_ROOT"

# 安装依赖（如果需要）
if [ ! -d "node_modules" ]; then
    log_info "安装依赖..."
    bun install
fi

# 构建生产版本
log_info "执行生产构建..."
bun run build

if [ ! -d "dist" ]; then
    log_error "构建失败，未找到 dist 目录"
    exit 1
fi

log_success "构建完成"

# ============================================================
# 步骤 3: 创建部署目录
# ============================================================
log_info "创建部署目录: $DEPLOY_DIR"

# 检查是否有权限
if [ ! -w "$(dirname "$DEPLOY_DIR")" ]; then
    log_warn "需要 sudo 权限创建目录"
    sudo mkdir -p "$DEPLOY_DIR"
    sudo mkdir -p "$DATA_DIR"
    sudo chown -R $(whoami):$(whoami) "$DEPLOY_DIR"
else
    mkdir -p "$DEPLOY_DIR"
    mkdir -p "$DATA_DIR"
fi

# ============================================================
# 步骤 4: 复制文件
# ============================================================
log_info "复制构建产物..."

# 备份旧版本（如果存在）
if [ -d "$DEPLOY_DIR/dist" ]; then
    BACKUP_DIR="$DEPLOY_DIR/dist.backup.$(date +%Y%m%d_%H%M%S)"
    log_info "备份旧版本到: $BACKUP_DIR"
    mv "$DEPLOY_DIR/dist" "$BACKUP_DIR"
fi

# 复制新版本
cp -r "$PROJECT_ROOT/dist" "$DEPLOY_DIR/"

log_success "文件复制完成"

# ============================================================
# 步骤 5: 复制示例数据（如果存在）
# ============================================================
SAMPLE_DATA="$PROJECT_ROOT/签单清洗/优化处理后的业务数据.parquet"
if [ -f "$SAMPLE_DATA" ]; then
    log_info "复制示例数据..."
    cp "$SAMPLE_DATA" "$DATA_DIR/业务数据.parquet"
    log_success "示例数据已复制"
else
    log_warn "未找到示例数据文件，请手动复制 Parquet 文件到: $DATA_DIR/业务数据.parquet"
fi

# ============================================================
# 步骤 6: 配置 Nginx（可选）
# ============================================================
if command -v nginx &> /dev/null; then
    log_info "检测到 Nginx，是否配置？(y/n)"
    read -r CONFIGURE_NGINX

    if [ "$CONFIGURE_NGINX" == "y" ]; then
        log_info "配置 Nginx..."

        # 复制配置文件
        sudo cp "$SCRIPT_DIR/nginx.conf" "$NGINX_CONF"

        # 修改配置中的路径
        sudo sed -i "s|/var/www/chexian|$DEPLOY_DIR|g" "$NGINX_CONF" 2>/dev/null || \
        sudo sed -i '' "s|/var/www/chexian|$DEPLOY_DIR|g" "$NGINX_CONF"

        # 创建软链接
        if [ ! -L "/etc/nginx/sites-enabled/chexian" ]; then
            sudo ln -s "$NGINX_CONF" /etc/nginx/sites-enabled/chexian
        fi

        # 测试配置
        if sudo nginx -t; then
            sudo systemctl reload nginx 2>/dev/null || sudo nginx -s reload
            log_success "Nginx 配置完成"
        else
            log_error "Nginx 配置测试失败，请检查配置文件"
        fi
    fi
else
    log_warn "未检测到 Nginx，跳过配置"
    log_info "请手动配置 Web 服务器，参考: $SCRIPT_DIR/nginx.conf"
fi

# ============================================================
# 完成
# ============================================================
echo ""
echo "============================================================"
log_success "部署完成！"
echo "============================================================"
echo ""
echo "部署目录: $DEPLOY_DIR"
echo "数据目录: $DATA_DIR"
echo ""
echo "下一步操作："
echo "  1. 确保 Parquet 数据文件已放置在: $DATA_DIR/业务数据.parquet"
echo "  2. 修改 Nginx 配置中的 server_name 为实际内网IP"
echo "  3. 访问 http://<内网IP>/ 测试"
echo ""
echo "数据更新命令："
echo "  $SCRIPT_DIR/update-data.sh /path/to/new-data.parquet"
echo ""
