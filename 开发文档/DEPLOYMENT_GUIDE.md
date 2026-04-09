# 车险数据分析平台 - 生产部署指引

> **目标**：将项目部署到腾讯云 VPS（162.14.113.44），配置 HTTPS + 内网访问 + 审计日志

---

## 一、部署架构概览

```
用户（内网 192.168.x.x） → HTTPS :443 → Nginx（IP 白名单）
                                         ├─ / → 前端静态文件
                                         └─ /api/ → PM2 后端服务 :3000
```

**安全保障**：
- ✅ HTTPS 强制（Let's Encrypt SSL）
- ✅ 内网 IP 白名单（外网完全禁止）
- ✅ JWT 认证（24h Token）
- ✅ 审计日志（记录所有查询操作）

**资源占用**：
- 内存：~400MB / 4GB (10%)
- 磁盘：~420MB / 70GB (0.6%)

---

## 二、本地构建（Mac 上执行）

### 步骤 1：前端构建

```bash
cd /Users/alongor666/Downloads/底层数据湖DUD/chexian-api

# 安装依赖
bun install

# 生产构建（产物：dist/，约 28MB）
bun run build
```

### 步骤 2：后端编译

```bash
cd server

# 安装生产依赖
bun install --production

# TypeScript 编译（产物：server/dist/，约 500KB）
bun run build
```

### 步骤 3：打包上传

```bash
cd ..

# 打包代码
tar -czf chexian-deploy.tar.gz \
    dist/ \
    server/dist/ \
    server/package.json \
    server/ecosystem.config.cjs

# 上传到 VPS
scp -i ~/.ssh/id_ed25519 chexian-deploy.tar.gz root@162.14.113.44:/tmp/

# 上传数据文件
cd 数据管理/warehouse/fact/policy
scp -i ~/.ssh/id_ed25519 车险保单综合明细表0212.parquet \
    root@162.14.113.44:/tmp/

cd ../../dim/业务员归属与规划
scp -i ~/.ssh/id_ed25519 salesman_organization_mapping.json \
    root@162.14.113.44:/tmp/
```

---

## 三、VPS 部署（SSH 连接 VPS 后执行）

### 步骤 0：环境准备

```bash
# SSH 连接 VPS
ssh -i ~/.ssh/id_ed25519 root@162.14.113.44

# 加载 Node.js 环境
source /root/.nvm/nvm.sh
node --version  # 确认 v22.22.0

# 安装 PM2（如未安装）
npm install -g pm2

# 创建目录
mkdir -p /var/www/chexian/{frontend,server,logs}
mkdir -p /var/www/chexian/server/data
chmod 700 /var/www/chexian/server/data
chmod 700 /var/www/chexian/logs
```

### 步骤 1：解压代码和数据

```bash
# 解压代码
cd /var/www/chexian
tar -xzf /tmp/chexian-deploy.tar.gz
mv dist frontend/dist

# 移动数据文件
mv /tmp/车险保单综合明细表0212.parquet server/data/
mv /tmp/salesman_organization_mapping.json server/data/

# 安装后端依赖
cd server
npm install --production

# 验证 Parquet 文件完整性
xxd -l 4 data/车险保单综合明细表0212.parquet
# 预期输出: 00000000: 5041 5231  PAR1

# 设置文件权限
chmod 600 data/*.parquet
chmod 600 data/*.json
```

### 步骤 2：配置环境变量

```bash
cd /var/www/chexian/server

# 生成强随机 JWT_SECRET
JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')

# 创建 .env 文件
cat > .env << EOF
NODE_ENV=production
PORT=3000
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=24h
CORS_ORIGIN=https://chexian.cretvalu.com
DUCKDB_PATH=./data/chexian.duckdb
DATA_PATH=./data
LOG_LEVEL=warn
AUDIT_LOG_PATH=../logs/audit.log
# DuckDB 内存与线程（腾讯云轻量 2核4G）
DUCKDB_MAX_MEMORY=1.2GB
DUCKDB_THREADS=2
EOF

# 设置权限
chmod 600 .env

# 验证配置（不显示 JWT_SECRET）
cat .env | grep -v JWT_SECRET
```

### 步骤 3：PM2 配置与启动

```bash
source /root/.nvm/nvm.sh

# 启动 PM2
pm2 start ecosystem.config.cjs --env production

# 查看状态
pm2 status
pm2 logs chexian-api --lines 50

# 设置开机自启
pm2 startup
pm2 save

# 健康检查
curl http://localhost:3000/health
# 预期: {"success":true,"message":"Server is running",...}
```

### 步骤 4：Nginx 配置

**创建站点配置**：

```bash
cat > /etc/nginx/conf.d/chexian.conf << 'EOF'
# IP 白名单配置
geo $allowed_ip {
    default 0;
    10.0.0.0/8 1;         # 内网 A 类
    172.16.0.0/12 1;      # 内网 B 类
    192.168.0.0/16 1;     # 内网 C 类
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

    # SSL 证书（certbot 自动填充）

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

        # 静态资源缓存
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # 后端 API 反向代理
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # 传递客户端真实 IP
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 超时配置
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
EOF

# 测试配置
nginx -t

# 重新加载
systemctl reload nginx
```

### 步骤 5：DNS 配置

**腾讯云 DNS 控制台**（浏览器操作）：

1. 登录腾讯云控制台
2. 进入「云解析 DNS」
3. 选择域名 `cretvalu.com`
4. 添加 A 记录：
   - 主机记录：`chexian`
   - 记录类型：`A`
   - 记录值：`162.14.113.44`
   - TTL：`600`

**验证 DNS**：

```bash
dig chexian.cretvalu.com
# 预期: chexian.cretvalu.com. 600 IN A 162.14.113.44
```

### 步骤 6：SSL 证书申请

```bash
# 申请 Let's Encrypt 证书
certbot --nginx -d chexian.cretvalu.com

# 根据提示操作：
# 1. 输入邮箱（用于证书过期提醒）
# 2. 同意服务条款
# 3. 选择「2: Redirect」（强制 HTTPS）

# 验证证书
certbot certificates

# 测试 HTTPS 访问
curl -I https://chexian.cretvalu.com
# 预期: HTTP/2 200
```

### 步骤 7：日志轮转配置

```bash
cat > /etc/logrotate.d/chexian << 'EOF'
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
EOF

# 测试配置
logrotate -d /etc/logrotate.d/chexian
```

### 步骤 8：数据备份自动化

```bash
cat > /root/backup-chexian.sh << 'EOF'
#!/bin/bash
BACKUP_DIR=/var/backups/chexian
DATE=$(date +%Y%m%d)

mkdir -p $BACKUP_DIR

# 备份数据文件
tar -czf $BACKUP_DIR/chexian-data-$DATE.tar.gz \
    /var/www/chexian/server/data/*.parquet \
    /var/www/chexian/server/data/*.json \
    /var/www/chexian/logs/audit.log

# 备份环境变量（仅首次）
if [ ! -f $BACKUP_DIR/env-backup.txt ]; then
    cat /var/www/chexian/server/.env > $BACKUP_DIR/env-backup.txt
    chmod 600 $BACKUP_DIR/env-backup.txt
fi

# 保留最近 30 天
find $BACKUP_DIR -name "chexian-data-*" -mtime +30 -delete

echo "[$(date)] 备份完成: $BACKUP_DIR/chexian-data-$DATE.tar.gz"
EOF

chmod +x /root/backup-chexian.sh

# 添加定时任务（每天凌晨 2:00）
crontab -e
# 添加以下行:
# 0 2 * * * /root/backup-chexian.sh >> /var/log/chexian-backup.log 2>&1
```

### 步骤 9：腾讯云安全组配置

**登录腾讯云控制台**（浏览器操作）：

1. 进入「轻量应用服务器」控制台
2. 选择实例 `lhins-3mmzz0py`（龙腾云_2核4G）
3. 点击「防火墙」标签页
4. 确认规则：

| 协议 | 端口 | 策略 |
|------|------|------|
| TCP | 22 | 允许所有 IP |
| TCP | 80 | 允许所有 IP |
| TCP | 443 | 允许所有 IP |
| TCP | 3000 | **删除此规则**（禁止外网访问） |

---

## 四、验证部署

### VPS 上验证

```bash
# 1. PM2 服务状态
pm2 status
# 预期: chexian-api | online

# 2. 后端健康检查
curl http://localhost:3000/health
# 预期: {"success":true,"message":"Server is running"}

# 3. Nginx 状态
systemctl status nginx
# 预期: active (running)

# 4. DNS 解析
dig +short chexian.cretvalu.com
# 预期: 162.14.113.44

# 5. SSL 证书
curl -I https://chexian.cretvalu.com
# 预期: HTTP/2 200

# 6. 文件权限
ls -l server/.env server/data/*.parquet
# 预期: -rw------- (600)

# 7. 审计日志生成（登录后查询数据，然后检查）
tail -f /var/www/chexian/logs/audit.log
```

### 本地 Mac 或内网电脑验证

```bash
# 1. 浏览器访问
# 打开 https://chexian.cretvalu.com
# - 应显示登录页面（无 SSL 警告）
# - 登录：admin / admin123
# - 查看仪表盘数据

# 2. API 请求测试
curl -X POST https://chexian.cretvalu.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
# 预期: {"success":true,"data":{"token":"..."}}
```

### 外网访问测试（应被拒绝）

```bash
# 从外网（非 192.168.x.x）访问
curl -I https://chexian.cretvalu.com
# 预期: HTTP/2 403 Forbidden
```

---

## 五、安全核对清单

**部署完成后逐项确认**：

| 安全项 | 验证方法 | 状态 |
|--------|---------|------|
| ✅ HTTPS 强制 | `curl -I http://chexian.cretvalu.com` → 301 重定向 | □ |
| ✅ SSL 证书有效 | `curl https://chexian.cretvalu.com` → 无错误 | □ |
| ✅ 内网 IP 白名单 | 外网访问 → 403 Forbidden | □ |
| ✅ 后端端口不对外 | 外网 `curl http://162.14.113.44:3000` → 拒绝连接 | □ |
| ✅ JWT_SECRET 强度 | 检查 .env 文件 → ≥64 字符 | □ |
| ✅ .env 权限 | `ls -l server/.env` → 600 | □ |
| ✅ 数据文件权限 | `ls -l server/data/*.parquet` → 600 | □ |
| ✅ 审计日志生成 | 执行查询后检查 `audit.log` → 有记录 | □ |
| ✅ 日志轮转配置 | `ls /etc/logrotate.d/chexian` → 存在 | □ |
| ✅ PM2 开机自启 | `pm2 startup` → 已配置 | □ |
| ✅ 备份定时任务 | `crontab -l` → 已添加 | □ |
| ✅ 腾讯云安全组 | 控制台检查端口 3000 → 已关闭 | □ |

---

## 六、一键数据同步

### 同步最新 Parquet 数据到 VPS

```bash
# 在本地 Mac 的 chexian-api 目录执行
./scripts/sync-vps.mjs                   # 自动同步最新 Parquet
./scripts/sync-vps.mjs 某文件.parquet     # 指定文件
```

脚本自动完成：
1. 找到 `数据管理/warehouse/fact/policy/` 下最新的 `.parquet` 文件
2. scp 上传到 VPS `/var/www/chexian/server/data/`
3. chmod 600 设置安全权限
4. PM2 重启后端服务
5. 健康检查验证服务正常

> **注意**：数据不会自动同步，每次本地数据更新后需手动执行此脚本。

---

## 七、日常运维

### 监控命令

```bash
# PM2 实时监控
pm2 monit

# 查看日志
pm2 logs chexian-api
tail -f /var/www/chexian/logs/audit.log

# 资源监控
free -h
df -h /var/www/chexian

# 审计日志分析
cat /var/www/chexian/logs/audit.log | jq -r '.username' | sort | uniq -c | sort -rn  # 访问最多的用户
cat /var/www/chexian/logs/audit.log | jq 'select(.duration > 5000)'  # 慢查询（>5秒）
```

### 更新流程（零停机）

```bash
# === 本地 Mac 构建 ===
cd /path/to/chexian-api
git pull
bun run build
cd server && bun run build
tar -czf chexian-update-$(date +%Y%m%d).tar.gz dist/ server/dist/

# 上传到 VPS
scp chexian-update-*.tar.gz root@162.14.113.44:/tmp/

# === VPS 上 ===
cd /var/www/chexian
tar -xzf /tmp/chexian-update-*.tar.gz
pm2 reload chexian-api  # 零停机重启

# 验证
pm2 logs chexian-api --lines 20
curl http://localhost:3000/health
```

### 应急公网开放（带自动回滚）

> 仅用于临时演示或紧急排障。默认策略仍应保持「白名单 + JWT」。

```bash
# 1) 从本地上传最新脚本到 VPS 固定路径
scp -i ~/.ssh/id_ed25519 ./deploy/vps-deploy.mjs \
  root@162.14.113.44:/usr/local/bin/chexian-vps-deploy.mjs

# 2) 进入 VPS（Asia/Beijing 时区）
ssh -i ~/.ssh/id_ed25519 root@162.14.113.44
chmod 755 /usr/local/bin/chexian-vps-deploy.mjs

# 3) 临时开放公网访问 + Basic Auth + 到点自动回滚
bash /usr/local/bin/chexian-vps-deploy.mjs \
  --action emergency-open \
  --until "2026-02-20 23:59" \
  --basic-auth-user temp-access

# 4) 记录脚本输出的临时密码（若未显式传 --basic-auth-pass 会自动生成）
# 5) 确认回滚任务
atq
```

**开放后验证（非白名单公网）**：

```bash
# 预期：401（出现 Basic Auth challenge）
curl -I https://chexian.cretvalu.com/

# 预期：200（或前端入口正常响应）
curl -u temp-access:'<临时密码>' -I https://chexian.cretvalu.com/
```

**手动回滚（若需提前结束）**：

```bash
bash /usr/local/bin/chexian-vps-deploy.mjs --action rollback-access
```

**自动回滚后验证（2026-02-20 23:59 之后）**：

```bash
# 预期恢复 403（白名单策略）
curl -I https://chexian.cretvalu.com/

# 配置检查
nginx -t && systemctl reload nginx
```

---

## 八、故障恢复

### 快速回滚

```bash
# 1. 停止当前服务
pm2 stop chexian-api

# 2. 恢复备份（如有 Git 版本控制）
cd /var/www/chexian
git checkout <上一个稳定版本>

# 3. 重新构建
npm run build && cd server && npm run build

# 4. 重启服务
pm2 start ecosystem.config.cjs
```

### 数据恢复

```bash
# 查看备份列表
ls -lh /var/backups/chexian/

# 恢复指定日期的数据
BACKUP_DATE=20260214
tar -xzf /var/backups/chexian/chexian-data-$BACKUP_DATE.tar.gz -C /

# 重启服务
pm2 reload chexian-api
```

---

## 九、常见问题

### Q1: Nginx 报 "Address already in use" 错误？
```bash
# 检查端口占用
ss -tlnp | grep :80
ss -tlnp | grep :443

# 停止冲突服务或重启 Nginx
systemctl restart nginx
```

### Q2: PM2 启动后立即退出？
```bash
# 查看错误日志
pm2 logs chexian-api --err

# 常见问题：
# - 端口 3000 已被占用 → 修改 .env 的 PORT
# - 数据文件缺失 → 检查 server/data/ 目录
# - 环境变量错误 → 检查 .env 文件格式
```

### Q3: 外网无法访问 HTTPS？
```bash
# 1. 检查 DNS 解析
dig chexian.cretvalu.com

# 2. 检查腾讯云安全组
# 确保端口 443 已开放

# 3. 检查 Nginx 配置
nginx -t
systemctl status nginx
```

### Q4: 审计日志没有记录？
```bash
# 1. 检查日志文件权限
ls -l /var/www/chexian/logs/audit.log

# 2. 检查中间件是否注册
cd /var/www/chexian/server
grep -n "auditMiddleware" dist/app.js

# 3. 手动触发查询并检查
tail -f /var/www/chexian/logs/audit.log
# 然后在浏览器执行查询操作
```

---

## 十、联系与支持

- **完整计划文档**：`.claude/plans/fluffy-gathering-giraffe.md`
- **项目架构**：`ARCHITECTURE.md`
- **开发文档**：`CLAUDE.md`

**部署完成后访问地址**：`https://chexian.cretvalu.com`

---

**预估部署时间**：~3 小时（包含测试验证）

**核心安全保障**：
1. 三层防护（HTTPS + Nginx IP 白名单 + JWT 认证）
2. 审计日志（记录所有查询操作）
3. 文件权限（敏感文件 600）
4. 自动化运维（PM2 自动重启 + 日志轮转 + 数据备份）
