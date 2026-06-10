#!/bin/bash
# 车险数据分析平台 - VPS 部署脚本
# 使用方法：
#   bash vps-deploy.sh                                            # 默认全量部署（兼容旧行为）
#   bash vps-deploy.sh --action deploy-full
#   bash vps-deploy.sh --action emergency-open --until "2026-02-20 23:59" --basic-auth-user temp-access [--basic-auth-pass xxx]
#   bash vps-deploy.sh --action rollback-access

set -euo pipefail

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 配置变量
PROJECT_ROOT="/var/www/chexian"
DOMAIN="chexian.cretvalu.com"
NODE_VERSION="v22.22.0"
NGINX_CONF_PATH="/etc/nginx/conf.d/chexian.conf"
EMERGENCY_HTPASSWD_PATH="/etc/nginx/.htpasswd_chexian_temp"
EMERGENCY_STATE_PATH="${PROJECT_ROOT}/logs/emergency-access.state"
EMERGENCY_ROLLBACK_LOG="${PROJECT_ROOT}/logs/emergency-access-rollback.log"
SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

# CLI 参数
ACTION="deploy-full"
UNTIL=""
BASIC_AUTH_USER="temp-access"
BASIC_AUTH_PASS=""

# 调度状态（用于落盘）
SCHEDULE_MODE=""
AT_JOB_ID=""
CRON_TAG=""

usage() {
  cat << 'USAGE'
用法：
  bash vps-deploy.sh [--action ACTION] [--until "YYYY-MM-DD HH:MM"] [--basic-auth-user USER] [--basic-auth-pass PASS]

参数：
  --action             deploy-full | emergency-open | rollback-access（默认 deploy-full）
  --until              emergency-open 必填，回滚时间（服务器本地时区）
  --basic-auth-user    emergency-open 可选，临时 Basic Auth 用户名（默认 temp-access）
  --basic-auth-pass    emergency-open 可选，临时 Basic Auth 密码（不传则自动生成）
  -h, --help           显示帮助

示例：
  bash vps-deploy.sh
  bash vps-deploy.sh --action emergency-open --until "2026-02-20 23:59" --basic-auth-user temp-access
  bash vps-deploy.sh --action rollback-access
USAGE
}

log_info() {
  echo -e "${GREEN}$1${NC}"
}

log_warn() {
  echo -e "${YELLOW}$1${NC}"
}

log_error() {
  echo -e "${RED}$1${NC}"
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --action)
        ACTION="${2:-}"
        shift 2
        ;;
      --until)
        UNTIL="${2:-}"
        shift 2
        ;;
      --basic-auth-user)
        BASIC_AUTH_USER="${2:-}"
        shift 2
        ;;
      --basic-auth-pass)
        BASIC_AUTH_PASS="${2:-}"
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        log_error "错误：未知参数 $1"
        usage
        exit 1
        ;;
    esac
  done

  case "$ACTION" in
    deploy-full|emergency-open|rollback-access)
      ;;
    *)
      log_error "错误：--action 仅支持 deploy-full | emergency-open | rollback-access"
      exit 1
      ;;
  esac
}

require_root() {
  if [ "${EUID}" -ne 0 ]; then
    log_error "错误：该脚本需 root 权限执行"
    exit 1
  fi
}

ensure_until_valid() {
  if [ -z "$UNTIL" ]; then
    log_error "错误：emergency-open 模式必须传入 --until \"YYYY-MM-DD HH:MM\""
    exit 1
  fi

  if ! date -d "$UNTIL" "+%Y%m%d%H%M" >/dev/null 2>&1; then
    log_error "错误：--until 格式无效，请使用 YYYY-MM-DD HH:MM"
    exit 1
  fi

  local now_epoch
  local until_epoch
  now_epoch=$(date +%s)
  until_epoch=$(date -d "$UNTIL" +%s)

  if [ "$until_epoch" -le "$now_epoch" ]; then
    log_error "错误：--until 必须是未来时间（服务器本地时区）"
    exit 1
  fi
}

generate_temp_password() {
  if [ -n "$BASIC_AUTH_PASS" ]; then
    return
  fi

  BASIC_AUTH_PASS=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 20)
  if [ -z "$BASIC_AUTH_PASS" ]; then
    log_error "错误：自动生成临时密码失败"
    exit 1
  fi
}

prepare_htpasswd() {
  generate_temp_password

  local hash
  hash=$(openssl passwd -apr1 "$BASIC_AUTH_PASS")
  echo "${BASIC_AUTH_USER}:${hash}" > "$EMERGENCY_HTPASSWD_PATH"

  if getent group nginx >/dev/null 2>&1; then
    chgrp nginx "$EMERGENCY_HTPASSWD_PATH" || true
    chmod 640 "$EMERGENCY_HTPASSWD_PATH"
  else
    chmod 644 "$EMERGENCY_HTPASSWD_PATH"
  fi
}

render_nginx_conf_private() {
  cat << 'NGINXEOF'
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
}

render_nginx_conf_emergency_open() {
  cat << NGINXEOF
# 应急公网开放模式（临时）
# 说明：该配置移除了 IP 白名单，改为临时 Basic Auth。
# 回滚后会恢复原配置。

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # 临时 Basic Auth（应急期间生效）
    auth_basic "Temporary Emergency Access";
    auth_basic_user_file ${EMERGENCY_HTPASSWD_PATH};

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    access_log /var/www/chexian/logs/nginx-access.log combined;
    error_log /var/www/chexian/logs/nginx-error.log warn;

    location / {
        root /var/www/chexian/frontend/dist;
        index index.html;
        try_files \$uri \$uri/ /index.html;

        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    location /health {
        proxy_pass http://127.0.0.1:3000/health;
        access_log off;
    }

    location ~ /\. {
        deny all;
    }
}
NGINXEOF
}

write_emergency_state() {
  local backup_conf="$1"

  cat > "$EMERGENCY_STATE_PATH" << STATEEOF
STATE_VERSION=1
MODE=emergency-open
CREATED_AT=$(date '+%Y-%m-%d %H:%M:%S %z')
UNTIL=${UNTIL}
BACKUP_CONF=${backup_conf}
HTPASSWD_FILE=${EMERGENCY_HTPASSWD_PATH}
BASIC_AUTH_USER=${BASIC_AUTH_USER}
SCHEDULE_MODE=${SCHEDULE_MODE}
AT_JOB_ID=${AT_JOB_ID}
CRON_TAG=${CRON_TAG}
SCRIPT_PATH=${SCRIPT_PATH}
STATEEOF

  chmod 600 "$EMERGENCY_STATE_PATH"
}

load_emergency_state() {
  if [ ! -f "$EMERGENCY_STATE_PATH" ]; then
    log_error "错误：未找到应急状态文件 ${EMERGENCY_STATE_PATH}"
    exit 1
  fi

  BACKUP_CONF=""
  HTPASSWD_FILE=""
  SCHEDULE_MODE=""
  AT_JOB_ID=""
  CRON_TAG=""

  while IFS='=' read -r key value; do
    [ -z "$key" ] && continue
    case "$key" in
      BACKUP_CONF) BACKUP_CONF="$value" ;;
      HTPASSWD_FILE) HTPASSWD_FILE="$value" ;;
      SCHEDULE_MODE) SCHEDULE_MODE="$value" ;;
      AT_JOB_ID) AT_JOB_ID="$value" ;;
      CRON_TAG) CRON_TAG="$value" ;;
      *) ;;
    esac
  done < "$EMERGENCY_STATE_PATH"

  if [ -z "$BACKUP_CONF" ]; then
    log_error "错误：状态文件缺少 BACKUP_CONF"
    exit 1
  fi
}

remove_rollback_schedule() {
  if [ "$SCHEDULE_MODE" = "at" ] && [ -n "$AT_JOB_ID" ]; then
    atrm "$AT_JOB_ID" 2>/dev/null || true
  fi

  if [ "$SCHEDULE_MODE" = "cron" ] && [ -n "$CRON_TAG" ]; then
    local tmp_cron
    tmp_cron=$(mktemp)
    crontab -l 2>/dev/null | grep -v "$CRON_TAG" > "$tmp_cron" || true
    if [ -s "$tmp_cron" ]; then
      crontab "$tmp_cron"
    else
      crontab -r 2>/dev/null || true
    fi
    rm -f "$tmp_cron"
  fi
}

schedule_rollback() {
  local until_at
  local rollback_cmd

  until_at=$(date -d "$UNTIL" +%Y%m%d%H%M)
  rollback_cmd="bash '${SCRIPT_PATH}' --action rollback-access >> '${EMERGENCY_ROLLBACK_LOG}' 2>&1"

  if command -v at >/dev/null 2>&1; then
    local at_output
    local at_rc
    set +e
    at_output=$(echo "$rollback_cmd" | at -t "$until_at" 2>&1)
    at_rc=$?
    set -e
    if [ "$at_rc" -eq 0 ]; then
      AT_JOB_ID=$(echo "$at_output" | awk '/job/{print $2; exit}')
      SCHEDULE_MODE="at"
      CRON_TAG=""
      return
    fi
    log_warn "警告：at 调度失败，自动降级到 cron。详情: ${at_output}"
  fi

  # 降级到 one-shot cron
  local minute hour day month tag cron_line tmp_cron
  minute=$(date -d "$UNTIL" +%M)
  hour=$(date -d "$UNTIL" +%H)
  day=$(date -d "$UNTIL" +%d)
  month=$(date -d "$UNTIL" +%m)
  tag="CHEXIAN_EMERGENCY_ROLLBACK_$(date +%s)"

  cron_line="${minute} ${hour} ${day} ${month} * ${rollback_cmd}; (crontab -l 2>/dev/null | grep -v '${tag}') | crontab - # ${tag}"
  tmp_cron=$(mktemp)
  (crontab -l 2>/dev/null || true) > "$tmp_cron"
  echo "$cron_line" >> "$tmp_cron"
  crontab "$tmp_cron"
  rm -f "$tmp_cron"

  SCHEDULE_MODE="cron"
  CRON_TAG="$tag"
  AT_JOB_ID=""
}

open_emergency_access() {
  require_root
  ensure_until_valid

  if [ -f "$EMERGENCY_STATE_PATH" ]; then
    log_error "错误：检测到未回滚的应急状态，请先执行 --action rollback-access"
    exit 1
  fi

  if [ ! -f "$NGINX_CONF_PATH" ]; then
    log_error "错误：未找到 Nginx 配置 ${NGINX_CONF_PATH}"
    exit 1
  fi

  if [ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ] || [ ! -f "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" ]; then
    log_error "错误：未找到 SSL 证书文件，无法启用应急公网开放"
    exit 1
  fi

  mkdir -p "${PROJECT_ROOT}/logs"

  local timestamp backup_conf
  timestamp=$(date +%Y%m%d%H%M%S)
  backup_conf="${PROJECT_ROOT}/logs/chexian.conf.backup.${timestamp}"
  cp -a "$NGINX_CONF_PATH" "$backup_conf"

  prepare_htpasswd
  render_nginx_conf_emergency_open > "$NGINX_CONF_PATH"

  nginx -t
  systemctl reload nginx

  schedule_rollback
  write_emergency_state "$backup_conf"

  log_info "===================================================="
  log_info "  应急公网开放已启用（临时 Basic Auth）"
  log_info "===================================================="
  echo ""
  echo -e "${GREEN}访问地址：${NC}https://${DOMAIN}"
  echo -e "${GREEN}Basic Auth 用户：${NC}${BASIC_AUTH_USER}"
  echo -e "${GREEN}Basic Auth 密码：${NC}${BASIC_AUTH_PASS}"
  echo -e "${GREEN}自动回滚时间：${NC}${UNTIL} (服务器本地时区)"
  echo -e "${GREEN}状态文件：${NC}${EMERGENCY_STATE_PATH}"
  echo -e "${GREEN}配置备份：${NC}${backup_conf}"
  echo -e "${GREEN}回滚日志：${NC}${EMERGENCY_ROLLBACK_LOG}"

  if [ "$SCHEDULE_MODE" = "at" ]; then
    echo -e "${GREEN}调度方式：${NC}at (job id: ${AT_JOB_ID:-unknown})"
    echo "可用命令: atq"
  else
    echo -e "${YELLOW}调度方式：${NC}cron (at 不可用时的降级方案)"
    echo "可用命令: crontab -l | grep CHEXIAN_EMERGENCY_ROLLBACK"
  fi

  echo ""
  echo -e "${YELLOW}手动立即回滚命令：${NC}bash ${SCRIPT_PATH} --action rollback-access"
}

rollback_emergency_access() {
  require_root
  load_emergency_state

  if [ ! -f "$BACKUP_CONF" ]; then
    log_error "错误：备份配置不存在 ${BACKUP_CONF}"
    exit 1
  fi

  cp -a "$BACKUP_CONF" "$NGINX_CONF_PATH"

  if [ -n "$HTPASSWD_FILE" ] && [ -f "$HTPASSWD_FILE" ]; then
    rm -f "$HTPASSWD_FILE"
  fi

  remove_rollback_schedule

  nginx -t
  systemctl reload nginx

  local archived_state
  archived_state="${PROJECT_ROOT}/logs/emergency-access.rolledback.$(date +%Y%m%d%H%M%S).state"
  mv "$EMERGENCY_STATE_PATH" "$archived_state"
  chmod 600 "$archived_state" || true

  log_info "===================================================="
  log_info "  应急公网开放已回滚，白名单策略已恢复"
  log_info "===================================================="
  echo ""
  echo -e "${GREEN}恢复配置：${NC}${NGINX_CONF_PATH}"
  echo -e "${GREEN}状态归档：${NC}${archived_state}"
}

deploy_full() {
  require_root

  echo "===================================================="
  echo "  车险数据分析平台 - VPS 自动部署脚本"
  echo "  目标：HTTPS + 内网访问 + 审计日志"
  echo "===================================================="
  echo ""

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
  cat > .env << ENVEOF
NODE_ENV=production
PORT=3000
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=24h
CORS_ORIGIN=https://${DOMAIN}
DUCKDB_PATH=./data/chexian.duckdb
DATA_PATH=./data
LOG_LEVEL=warn
AUDIT_LOG_PATH=../logs/audit.log
ENVEOF

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
  if [ -f "$NGINX_CONF_PATH" ]; then
    echo -e "${YELLOW}Nginx 配置已存在，跳过创建${NC}"
  else
    render_nginx_conf_private > "$NGINX_CONF_PATH"
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
  read -r -p ""

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
  echo -e "${GREEN}登录账号：${NC}admin / <在凭据库/E2E_PASSWORD 环境变量中获取>"
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
}

main() {
  parse_args "$@"

  case "$ACTION" in
    deploy-full)
      deploy_full
      ;;
    emergency-open)
      open_emergency_access
      ;;
    rollback-access)
      rollback_emergency_access
      ;;
    *)
      log_error "错误：未知 action $ACTION"
      exit 1
      ;;
  esac
}

main "$@"
