#!/bin/bash
# ============================================
# VPS 安全加固脚本
# 腾讯云轻量服务器 (162.14.113.44)
# ============================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ============================================
# 1. SSH 安全加固
# ============================================
harden_ssh() {
    log_info "加固 SSH 配置..."

    # 备份原配置
    cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak.$(date +%Y%m%d)

    # 禁用密码认证（仅允许公钥）
    sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
    sed -i 's/^#*PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config

    # 禁用 root 密码登录（保留 root 公钥登录）
    sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config

    # 禁用空密码
    sed -i 's/^#*PermitEmptyPasswords.*/PermitEmptyPasswords no/' /etc/ssh/sshd_config

    # 限制认证尝试次数
    sed -i 's/^#*MaxAuthTries.*/MaxAuthTries 3/' /etc/ssh/sshd_config

    # 登录超时
    sed -i 's/^#*LoginGraceTime.*/LoginGraceTime 60/' /etc/ssh/sshd_config

    # 验证配置并重启
    if sshd -t; then
        systemctl restart sshd
        log_info "SSH 加固完成：密码认证已禁用"
    else
        log_error "SSH 配置验证失败，回滚..."
        mv /etc/ssh/sshd_config.bak.$(date +%Y%m%d) /etc/ssh/sshd_config
    fi
}

# ============================================
# 2. 安装配置 fail2ban
# ============================================
install_fail2ban() {
    log_info "安装 fail2ban..."

    # 安装
    dnf install -y fail2ban fail2ban-firewalld

    # 创建本地配置
    cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
# 封禁时长：1 小时
bantime = 3600
# 查找时间窗口：10 分钟
findtime = 600
# 最大尝试次数
maxretry = 5
# 忽略本地网络
ignoreip = 127.0.0.1/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/secure
maxretry = 3
bantime = 3600

[nginx-limit-req]
enabled = true
filter = nginx-limit-req
port = http,https
logpath = /var/www/chexian/logs/nginx-access.log
maxretry = 10
bantime = 3600
EOF

    # 创建 nginx 限流过滤器
    cat > /etc/fail2ban/filter.d/nginx-limit-req.conf << 'EOF'
[Definition]
failregex = limiting requests, excess:.* by zone.*client: <HOST>
ignoreregex =
EOF

    # 启动服务
    systemctl enable fail2ban
    systemctl start fail2ban

    log_info "fail2ban 安装完成"
    log_info "查看状态: fail2ban-client status sshd"
}

# ============================================
# 3. 系统级安全加固
# ============================================
harden_system() {
    log_info "系统级安全加固..."

    # 禁用不必要的服务
    systemctl disable --now bluetooth 2>/dev/null || true
    systemctl disable --now cups 2>/dev/null || true

    # 内核安全参数
    cat >> /etc/sysctl.conf << 'EOF'

# 安全加固参数
net.ipv4.tcp_syncookies = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
EOF

    sysctl -p

    # 限制 su 权限
    chmod 750 /bin/su 2>/dev/null || true
    chown root:wheel /bin/su 2>/dev/null || true

    # 设置文件描述符限制
    cat > /etc/security/limits.d/nofile.conf << 'EOF'
* soft nofile 65535
* hard nofile 65535
root soft nofile 65535
root hard nofile 65535
EOF

    log_info "系统加固完成"
}

# ============================================
# 4. Nginx 安全加固
# ============================================
harden_nginx() {
    log_info "Nginx 安全加固..."

    # 隐藏版本号
    if ! grep -q "server_tokens off" /etc/nginx/nginx.conf; then
        sed -i '/http {/a\    server_tokens off;' /etc/nginx/nginx.conf
    fi

    # 添加安全头
    cat > /etc/nginx/conf.d/security-headers.conf << 'EOF'
# 全局安全头
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()" always;

# HSTS (可选，需确保 HTTPS 稳定运行)
# add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
EOF

    # 创建限流区域
    cat > /etc/nginx/conf.d/rate-limit.conf << 'EOF'
# API 限流配置
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
limit_conn_zone $binary_remote_addr zone=conn_limit:10m;

# 登录接口严格限流
limit_req_zone $binary_remote_addr zone=login_limit:10m rate=5r/m;
EOF

    # 测试并重载
    nginx -t && systemctl reload nginx

    log_info "Nginx 加固完成"
}

# ============================================
# 5. 端口 3000 绑定修复
# ============================================
fix_port_binding() {
    log_info "修复后端端口绑定..."

    ECOSYSTEM_FILE="/var/www/chexian/server/ecosystem.config.cjs"

    if [ -f "$ECOSYSTEM_FILE" ]; then
        # 检查是否已修复
        if grep -q "HOST.*127.0.0.1" "$ECOSYSTEM_FILE"; then
            log_info "端口绑定已正确配置"
        else
            # 备份
            cp "$ECOSYSTEM_FILE" "${ECOSYSTEM_FILE}.bak.$(date +%Y%m%d)"

            # 修改配置
            sed -i "s/env: {}/env: { HOST: '127.0.0.1' }/" "$ECOSYSTEM_FILE" 2>/dev/null || \
            sed -i '/env: {/a\        HOST: "127.0.0.1",' "$ECOSYSTEM_FILE"

            log_info "端口绑定已修复为 127.0.0.1"
            log_warn "需要重启 PM2: pm2 restart chexian-api"
        fi
    else
        log_warn "ecosystem.config.cjs 不存在，跳过"
    fi
}

# ============================================
# 6. 定时安全检查
# ============================================
setup_security_cron() {
    log_info "配置安全检查定时任务..."

    cat > /root/security-check.sh << 'EOF'
#!/bin/bash
# 每日安全检查

LOG="/var/log/security-check.log"
DATE=$(date '+%Y-%m-%d %H:%M:%S')

echo "[$DATE] 安全检查开始" >> $LOG

# 检查异常登录
echo "=== 最近登录 ===" >> $LOG
last -n 10 >> $LOG

# 检查 fail2ban 状态
echo "=== fail2ban 状态 ===" >> $LOG
fail2ban-client status sshd >> $LOG 2>&1

# 检查磁盘使用
echo "=== 磁盘使用 ===" >> $LOG
df -h / >> $LOG

# 检查可疑进程
echo "=== 高 CPU 进程 ===" >> $LOG
ps aux --sort=-%cpu | head -5 >> $LOG

# 检查开放端口
echo "=== 开放端口 ===" >> $LOG
ss -tlnp >> $LOG

echo "[$DATE] 安全检查完成" >> $LOG
echo "" >> $LOG
EOF

    chmod +x /root/security-check.sh

    # 每天早上 6 点执行
    (crontab -l 2>/dev/null | grep -v "security-check"; echo "0 6 * * * /root/security-check.sh") | crontab -

    log_info "安全检查定时任务已配置"
}

# ============================================
# 7. 文件完整性监控 (可选)
# ============================================
setup_aide() {
    log_info "安装 AIDE 文件完整性监控..."

    dnf install -y aide

    # 初始化数据库
    aide --init
    mv /var/lib/aide/aide.db.new.gz /var/lib/aide/aide.db.gz

    # 每日检查
    (crontab -l 2>/dev/null | grep -v "aide"; echo "0 3 * * * /usr/sbin/aide --check") | crontab -

    log_info "AIDE 已安装并配置"
}

# ============================================
# 主流程
# ============================================
main() {
    echo ""
    echo "============================================"
    echo "  VPS 安全加固脚本"
    echo "  服务器: 162.14.113.44"
    echo "  时间: $(date)"
    echo "============================================"
    echo ""

    # 检查 root 权限
    if [ "$EUID" -ne 0 ]; then
        log_error "请使用 root 权限运行此脚本"
        exit 1
    fi

    # 交互式选择
    echo "请选择要执行的加固项目："
    echo "1) SSH 安全加固（禁用密码登录）"
    echo "2) 安装 fail2ban（防暴力破解）"
    echo "3) 系统级安全加固"
    echo "4) Nginx 安全加固"
    echo "5) 修复后端端口绑定"
    echo "6) 配置安全检查定时任务"
    echo "7) 安装 AIDE 文件监控"
    echo "8) 执行全部"
    echo "0) 退出"
    echo ""
    read -p "请输入选项 (多个选项用空格分隔): " choices

    for choice in $choices; do
        case $choice in
            1) harden_ssh ;;
            2) install_fail2ban ;;
            3) harden_system ;;
            4) harden_nginx ;;
            5) fix_port_binding ;;
            6) setup_security_cron ;;
            7) setup_aide ;;
            8)
                harden_ssh
                install_fail2ban
                harden_system
                harden_nginx
                fix_port_binding
                setup_security_cron
                ;;
            0) exit 0 ;;
            *) log_error "无效选项: $choice" ;;
        esac
    done

    echo ""
    log_info "安全加固完成！"
    echo ""
    echo "后续建议："
    echo "1. 修改所有用户密码为强密码"
    echo "2. 定期检查审计日志: tail -f /var/www/chexian/logs/audit.log"
    echo "3. 监控 fail2ban 状态: fail2ban-client status sshd"
    echo "4. 定期更新系统: dnf update"
}

main "$@"
