#!/bin/bash
# ============================================================
# 车险业务分析系统 - 前后端分离一键部署脚本
# ============================================================
# 使用方法：
#   1. 上传项目到服务器
#   2. 修改脚本中的 SERVER_IP 变量
#   3. 运行: chmod +x deploy-fullstack.sh && ./deploy-fullstack.sh
# ============================================================

set -e  # 遇到错误立即退出

# ========== 配置变量（根据实际情况修改） ==========
SERVER_IP="YOUR_SERVER_IP"           # ⚠️ 必须修改：服务器 IP
DEPLOY_DIR="/var/www/chexian"        # 部署目录
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"  # 项目根目录
LOG_DIR="/var/log/chexian"           # 日志目录

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ========== 检查依赖 ==========
check_dependencies() {
    log_info "检查依赖..."

    # Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js 未安装。请先安装 Node.js 18+"
        echo "  安装命令: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
        exit 1
    fi
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        log_error "Node.js 版本过低，需要 18+，当前: $(node -v)"
        exit 1
    fi
    log_info "  Node.js: $(node -v) ✓"

    # npm
    if ! command -v npm &> /dev/null; then
        log_error "npm 未安装"
        exit 1
    fi
    log_info "  npm: $(npm -v) ✓"

    # PM2
    if ! command -v pm2 &> /dev/null; then
        log_warn "PM2 未安装，正在安装..."
        sudo npm install -g pm2
    fi
    log_info "  PM2: $(pm2 -v) ✓"

    # Nginx
    if ! command -v nginx &> /dev/null; then
        log_error "Nginx 未安装。请先安装 Nginx"
        echo "  安装命令: sudo apt install -y nginx"
        exit 1
    fi
    log_info "  Nginx: $(nginx -v 2>&1 | cut -d'/' -f2) ✓"

    log_info "依赖检查完成 ✓"
}

# ========== 创建目录结构 ==========
setup_directories() {
    log_info "创建目录结构..."

    sudo mkdir -p "$DEPLOY_DIR/dist"
    sudo mkdir -p "$DEPLOY_DIR/server/data"
    sudo mkdir -p "$LOG_DIR"

    # 设置权限
    sudo chown -R $(whoami):$(whoami) "$DEPLOY_DIR"
    sudo chown -R $(whoami):$(whoami) "$LOG_DIR"

    log_info "目录结构创建完成 ✓"
}

# ========== 构建前端 ==========
build_frontend() {
    log_info "构建前端..."
    cd "$PROJECT_DIR"

    # 检查 bun
    if command -v bun &> /dev/null; then
        bun install
        bun run build
    else
        log_warn "Bun 未安装，使用 npm 构建..."
        npm install
        npm run build
    fi

    log_info "前端构建完成 ✓"
}

# ========== 构建后端 ==========
build_backend() {
    log_info "构建后端..."
    cd "$PROJECT_DIR/server"

    npm install
    npm run build

    log_info "后端构建完成 ✓"
}

# ========== 部署文件 ==========
deploy_files() {
    log_info "部署文件..."

    # 前端静态文件
    log_info "  复制前端文件..."
    rm -rf "$DEPLOY_DIR/dist"/*
    cp -r "$PROJECT_DIR/dist"/* "$DEPLOY_DIR/dist/"

    # 后端文件
    log_info "  复制后端文件..."
    rm -rf "$DEPLOY_DIR/server/dist"
    rm -rf "$DEPLOY_DIR/server/node_modules"
    cp -r "$PROJECT_DIR/server/dist" "$DEPLOY_DIR/server/"
    cp -r "$PROJECT_DIR/server/node_modules" "$DEPLOY_DIR/server/"
    cp "$PROJECT_DIR/server/package.json" "$DEPLOY_DIR/server/"
    cp "$PROJECT_DIR/server/ecosystem.config.cjs" "$DEPLOY_DIR/server/"

    # 环境变量
    if [ -f "$PROJECT_DIR/server/.env.production" ]; then
        cp "$PROJECT_DIR/server/.env.production" "$DEPLOY_DIR/server/.env"
        log_warn "  请编辑 $DEPLOY_DIR/server/.env 修改 JWT_SECRET 和其他敏感配置！"
    fi

    log_info "文件部署完成 ✓"
}

# ========== 配置 Nginx ==========
configure_nginx() {
    log_info "配置 Nginx..."

    # 替换 IP 地址
    NGINX_CONF="$PROJECT_DIR/deploy/nginx-fullstack.conf"
    NGINX_TARGET="/etc/nginx/sites-available/chexian"

    sudo cp "$NGINX_CONF" "$NGINX_TARGET"
    sudo sed -i "s/YOUR_SERVER_IP/$SERVER_IP/g" "$NGINX_TARGET"

    # 启用站点
    if [ ! -L "/etc/nginx/sites-enabled/chexian" ]; then
        sudo ln -s "$NGINX_TARGET" /etc/nginx/sites-enabled/chexian
    fi

    # 禁用默认站点（可选）
    if [ -L "/etc/nginx/sites-enabled/default" ]; then
        sudo rm /etc/nginx/sites-enabled/default
    fi

    # 测试配置
    if ! sudo nginx -t; then
        log_error "Nginx 配置测试失败！"
        exit 1
    fi

    # 重启 Nginx
    sudo systemctl reload nginx

    log_info "Nginx 配置完成 ✓"
}

# ========== 启动后端服务 ==========
start_backend() {
    log_info "启动后端服务..."
    cd "$DEPLOY_DIR/server"

    # 停止旧服务
    pm2 delete chexian-api 2>/dev/null || true

    # 启动新服务
    pm2 start ecosystem.config.cjs --env production

    # 保存 PM2 配置（开机自启）
    pm2 save
    pm2 startup systemd -u $(whoami) --hp $HOME 2>/dev/null || true

    # 等待启动
    sleep 3

    # 检查状态
    pm2 status chexian-api

    log_info "后端服务启动完成 ✓"
}

# ========== 验证部署 ==========
verify_deployment() {
    log_info "验证部署..."

    # 检查后端健康
    sleep 2
    HEALTH_CHECK=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3000/health" || echo "000")
    if [ "$HEALTH_CHECK" = "200" ]; then
        log_info "  后端健康检查: ✓"
    else
        log_error "  后端健康检查失败 (HTTP $HEALTH_CHECK)"
        log_info "  查看日志: pm2 logs chexian-api"
    fi

    # 检查前端
    FRONTEND_CHECK=$(curl -s -o /dev/null -w "%{http_code}" "http://$SERVER_IP/" || echo "000")
    if [ "$FRONTEND_CHECK" = "200" ]; then
        log_info "  前端访问检查: ✓"
    else
        log_warn "  前端访问检查: HTTP $FRONTEND_CHECK（可能是 IP 白名单限制）"
    fi

    echo ""
    echo "=========================================="
    echo -e "${GREEN}部署完成！${NC}"
    echo "=========================================="
    echo ""
    echo "访问地址: http://$SERVER_IP/"
    echo ""
    echo "常用命令:"
    echo "  查看后端日志:  pm2 logs chexian-api"
    echo "  重启后端:      pm2 restart chexian-api"
    echo "  查看 Nginx 日志: tail -f /var/log/nginx/chexian_access.log"
    echo ""
    echo "⚠️ 重要提醒:"
    echo "  1. 编辑 $DEPLOY_DIR/server/.env 修改 JWT_SECRET"
    echo "  2. 上传数据文件到 $DEPLOY_DIR/server/data/"
    echo "  3. 根据需要调整 /etc/nginx/sites-available/chexian 中的 IP 白名单"
    echo ""
}

# ========== 主流程 ==========
main() {
    echo "=========================================="
    echo "车险业务分析系统 - 前后端分离部署"
    echo "=========================================="
    echo ""

    if [ "$SERVER_IP" = "YOUR_SERVER_IP" ]; then
        log_error "请先编辑脚本，设置 SERVER_IP 变量！"
        exit 1
    fi

    check_dependencies
    setup_directories
    build_frontend
    build_backend
    deploy_files
    configure_nginx
    start_backend
    verify_deployment
}

# 运行主流程
main "$@"
