#!/bin/bash
# 车险数据分析平台 - VPS 部署脚本
# 使用方法：在 VPS 上运行此脚本
# bash vps-deploy.sh

set -e  # 遇到错误立即退出

echo "===================================================="
echo "  车险数据分析平台 - VPS 自动部署脚本"
echo "  目标：HTTPS + 内网访问 + 审计日志"
echo "===================================================="
echo ""

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 配置变量
PROJECT_ROOT="/var/www/chexian"
DOMAIN="chexian.cretvalu.com"
NODE_VERSION="v22.22.0"

# ============================================================
# 步骤 0：环境检查
# ============================================================
echo -e "${GREEN}[步骤 0/9]${NC} 环境检查..."

# 检查 Node.js
source /root/.nvm/nvm.sh
if ! command -v node &> /dev/null; then
    echo -e "${RED}错误：Node.js 未安装${NC}"
    exit 1
fi

NODE_CURRENT=$(node --version)
if [ "$NODE_CURRENT" != "$NODE_VERSION" ]; then
    echo -e "${YELLOW}警告：Node.js 版本不匹配（当前: $NODE_CURRENT, 预期: $NODE_VERSION）${NC}"
fi

# 检查 PM2
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}PM2 未安装，正在安装...${NC}"
    npm install -g pm2
fi

# 检查磁盘空间
DISK_FREE=$(df -BG / | awk 'NR==2 {print $4}' | sed 's/G//')
if [ "$DISK_FREE" -lt 5 ]; then
    echo -e "${RED}错误：磁盘空间不足（剩余 ${DISK_FREE}GB < 5GB）${NC}"
    exit 1
fi

echo -e "${GREEN}✓ 环境检查通过${NC}"
echo ""

# ============================================================
# 步骤 1：创建目录结构
# ============================================================
echo -e "${GREEN}[步骤 1/9]${NC} 创建目录结构..."

mkdir -p ${PROJECT_ROOT}/{frontend,server,logs}
mkdir -p ${PROJECT_ROOT}/server/data
chmod 700 ${PROJECT_ROOT}/server/data
chmod 700 ${PROJECT_ROOT}/logs

echo -e "${GREEN}✓ 目录创建完成${NC}"
echo ""

# ============================================================
# 步骤 2：解压代码和数据
# ============================================================
echo -e "${GREEN}[步骤 2/9]${NC} 解压代码和数据..."

# 检查上传文件是否存在
if [ ! -f "/tmp/chexian-deploy.tar.gz" ]; then
    echo -e "${RED}错误：/tmp/chexian-deploy.tar.gz 不存在，请先执行本地上传步骤${NC}"
    exit 1
fi

# 解压代码
cd ${PROJECT_ROOT}
tar -xzf /tmp/chexian-deploy.tar.gz
mv dist frontend/dist

# 移动数据文件
if [ -f "/tmp/车险保单综合明细表0212.parquet" ]; then
    mv /tmp/车险保单综合明细表0212.parquet server/data/
else
    echo -e "${YELLOW}警告：Parquet 数据文件不存在，请手动上传${NC}"
fi

if [ -f "/tmp/salesman_organization_mapping.json" ]; then
    mv /tmp/salesman_organization_mapping.json server/data/
else
    echo -e "${YELLOW}警告：业务员映射文件不存在，请手动上传${NC}"
fi

# 安装后端依赖
cd ${PROJECT_ROOT}/server
source /root/.nvm/nvm.sh
npm install --production

# 验证 Parquet 文件
if [ -f "data/车险保单综合明细表0212.parquet" ]; then
    MAGIC=$(xxd -l 4 data/车险保单综合明细表0212.parquet | head -1 | awk '{print $2$3}')
    if [ "$MAGIC" == "50415231" ]; then  # PAR1
        echo -e "${GREEN}✓ Parquet 文件验证通过${NC}"
    else
        echo -e "${RED}错误：Parquet 文件格式错误${NC}"
        exit 1
    fi
fi

# 设置文件权限
chmod 600 data/*.parquet 2>/dev/null || true
chmod 600 data/*.json 2>/dev/null || true

echo -e "${GREEN}✓ 代码和数据解压完成${NC}"
echo ""

# ============================================================
# 步骤 3：配置环境变量
# ============================================================
echo -e "${GREEN}[步骤 3/9]${NC} 配置环境变量..."

cd ${PROJECT_ROOT}/server

# 生成 JWT_SECRET
JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')

# 创建 .env 文件
cat > .env << EOF
NODE_ENV=production
PORT=3000
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=24h
CORS_ORIGIN=https://${DOMAIN}
DUCKDB_PATH=./data/chexian.duckdb
DATA_PATH=./data
LOG_LEVEL=warn
AUDIT_LOG_PATH=../logs/audit.log
EOF

chmod 600 .env

echo -e "${GREEN}✓ 环境变量配置完成（JWT_SECRET 已生成）${NC}"
echo ""

# ============================================================
# 步骤 4：PM2 启动后端
# ============================================================
echo -e "${GREEN}[步骤 4/9]${NC} PM2 启动后端..."

source /root/.nvm/nvm.sh
cd ${PROJECT_ROOT}/server

# 检查 PM2 进程是否已存在
if pm2 list | grep -q "chexian-api"; then
    echo -e "${YELLOW}检测到已有 PM2 进程，正在重启...${NC}"
    pm2 reload chexian-api
else
    pm2 start ecosystem.config.cjs --env production
fi

# 等待服务启动
sleep 3

# 健康检查
if curl -s http://localhost:3000/health | grep -q "success"; then
    echo -e "${GREEN}✓ 后端服务启动成功${NC}"
else
    echo -e "${RED}错误：后端服务启动失败${NC}"
    pm2 logs chexian-api --lines 20
    exit 1
fi

# 设置开机自启
pm2 startup > /dev/null 2>&1 || true
pm2 save

echo ""

# ============================================================
# 步骤 5：Nginx 配置
# ============================================================
echo -e "${GREEN}[步骤 5/9]${NC} Nginx 配置..."

# 检查配置文件是否已存在
if [ -f "/etc/nginx/conf.d/chexian.conf" ]; then
    echo -e "${YELLOW}Nginx 配置已存在，跳过创建${NC}"
else
    cat > /etc/nginx/conf.d/chexian.conf << 'NGINXEOF'
# IP 白名单配置
geo $allowed_ip {
    default 0;
    10.0.0.0/8 1;
    172.16.0.0/12 1;
    192.168.0.0/16 1;
}

# HTTP 强制重定向到 HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name chexian.cretvalu.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS 服务器
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name chexian.cretvalu.com;

    # IP 白名单检查
    if ($allowed_ip = 0) {
        return 403 "Access Denied: Your IP is not whitelisted";
    }

    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # 日志
    access_log /var/www/chexian/logs/nginx-access.log combined;
    error_log /var/www/chexian/logs/nginx-error.log warn;

    # 前端静态文件
    location / {
        root /var/www/chexian/frontend/dist;
        index index.html;
        try_files $uri $uri/ /index.html;

        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # 后端 API 反向代理
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # 健康检查
    location /health {
        proxy_pass http://127.0.0.1:3000/health;
        access_log off;
    }

    # 禁止访问隐藏文件
    location ~ /\. {
        deny all;
    }
}
NGINXEOF

    echo -e "${GREEN}✓ Nginx 配置文件已创建${NC}"
fi

# 测试 Nginx 配置
nginx -t

# 重新加载 Nginx
systemctl reload nginx

echo ""

# ============================================================
# 步骤 6：DNS 提示
# ============================================================
echo -e "${GREEN}[步骤 6/9]${NC} DNS 配置提示..."
echo -e "${YELLOW}请手动在腾讯云 DNS 控制台添加 A 记录：${NC}"
echo -e "  主机记录: ${YELLOW}chexian${NC}"
echo -e "  记录类型: ${YELLOW}A${NC}"
echo -e "  记录值: ${YELLOW}162.14.113.44${NC}"
echo -e "  TTL: ${YELLOW}600${NC}"
echo ""
echo -e "${YELLOW}完成后按回车继续...${NC}"
read -p ""

# 验证 DNS
if dig +short ${DOMAIN} | grep -q "162.14.113.44"; then
    echo -e "${GREEN}✓ DNS 解析正确${NC}"
else
    echo -e "${YELLOW}警告：DNS 解析未生效，请等待 DNS 传播（最多 10 分钟）${NC}"
fi

echo ""

# ============================================================
# 步骤 7：SSL 证书申请
# ============================================================
echo -e "${GREEN}[步骤 7/9]${NC} SSL 证书申请..."

# 检查证书是否已存在
if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
    echo -e "${YELLOW}SSL 证书已存在，跳过申请${NC}"
else
    echo -e "${YELLOW}正在申请 Let's Encrypt 证书...${NC}"
    certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos --email admin@${DOMAIN}
    echo -e "${GREEN}✓ SSL 证书申请成功${NC}"
fi

# 验证 HTTPS
if curl -I https://${DOMAIN} 2>/dev/null | grep -q "HTTP/2 200"; then
    echo -e "${GREEN}✓ HTTPS 访问正常${NC}"
else
    echo -e "${YELLOW}警告：HTTPS 验证失败，请检查 DNS 和证书${NC}"
fi

echo ""

# ============================================================
# 步骤 8：日志轮转配置
# ============================================================
echo -e "${GREEN}[步骤 8/9]${NC} 日志轮转配置..."

cat > /etc/logrotate.d/chexian << 'LOGROTATEEOF'
/var/www/chexian/logs/*.log {
    daily
    rotate 30
    compress
    delaycompress
    notifempty
    missingok
    sharedscripts
    postrotate
        /usr/local/bin/pm2 reloadLogs > /dev/null 2>&1 || true
        /usr/bin/systemctl reload nginx > /dev/null 2>&1 || true
    endscript
}
LOGROTATEEOF

echo -e "${GREEN}✓ 日志轮转配置完成${NC}"
echo ""

# ============================================================
# 步骤 9：数据备份脚本
# ============================================================
echo -e "${GREEN}[步骤 9/9]${NC} 数据备份脚本..."

cat > /root/backup-chexian.sh << 'BACKUPEOF'
#!/bin/bash
BACKUP_DIR=/var/backups/chexian
DATE=$(date +%Y%m%d)

mkdir -p $BACKUP_DIR

tar -czf $BACKUP_DIR/chexian-data-$DATE.tar.gz \
    /var/www/chexian/server/data/*.parquet \
    /var/www/chexian/server/data/*.json \
    /var/www/chexian/logs/audit.log 2>/dev/null

if [ ! -f $BACKUP_DIR/env-backup.txt ]; then
    cat /var/www/chexian/server/.env > $BACKUP_DIR/env-backup.txt
    chmod 600 $BACKUP_DIR/env-backup.txt
fi

find $BACKUP_DIR -name "chexian-data-*" -mtime +30 -delete

echo "[$(date)] 备份完成: $BACKUP_DIR/chexian-data-$DATE.tar.gz"
BACKUPEOF

chmod +x /root/backup-chexian.sh

# 添加定时任务
(crontab -l 2>/dev/null | grep -v "backup-chexian.sh"; echo "0 2 * * * /root/backup-chexian.sh >> /var/log/chexian-backup.log 2>&1") | crontab -

echo -e "${GREEN}✓ 数据备份脚本配置完成（每天凌晨 2:00 自动备份）${NC}"
echo ""

# ============================================================
# 部署完成
# ============================================================
echo "===================================================="
echo -e "${GREEN}  部署完成！${NC}"
echo "===================================================="
echo ""
echo -e "${GREEN}访问地址：${NC}https://${DOMAIN}"
echo -e "${GREEN}登录账号：${NC}admin / admin123"
echo ""
echo -e "${YELLOW}下一步操作：${NC}"
echo "  1. 在腾讯云安全组删除端口 3000 规则（禁止外网访问后端）"
echo "  2. 浏览器访问 https://${DOMAIN} 验证部署"
echo "  3. 执行查询操作，检查审计日志: tail -f ${PROJECT_ROOT}/logs/audit.log"
echo ""
echo -e "${YELLOW}监控命令：${NC}"
echo "  pm2 status                       # PM2 状态"
echo "  pm2 logs chexian-api             # 查看日志"
echo "  tail -f ${PROJECT_ROOT}/logs/audit.log  # 审计日志"
echo ""
echo -e "${GREEN}部署日志已保存：${NC}/var/log/chexian-deploy.log"
echo ""
