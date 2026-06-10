# 车险业务分析系统 - 前后端分离部署指南

## 目录

- [架构概览](#架构概览)
- [服务器准备](#服务器准备)
- [一键部署](#一键部署)
- [手动部署](#手动部署)
- [配置说明](#配置说明)
- [运维操作](#运维操作)
- [故障排除](#故障排除)

---

## 架构概览

```
用户浏览器
    │
    │ HTTP (内网 IP 白名单)
    ▼
┌─────────────────────────────────────┐
│          Nginx (端口 80)             │
│  ├─ /api/*  → 反向代理后端 :3000     │
│  ├─ /*      → 前端静态文件           │
│  └─ /data/* → Parquet 数据文件       │
└─────────────────────────────────────┘
    │
    │ localhost:3000
    ▼
┌─────────────────────────────────────┐
│   Node.js + Express (PM2 管理)       │
│  ├─ JWT 认证                         │
│  ├─ 行级安全过滤                      │
│  └─ DuckDB 查询执行                   │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│   DuckDB + Parquet 数据文件          │
└─────────────────────────────────────┘
```

**技术栈**：
- 前端：React + TypeScript + Vite
- 后端：Node.js + Express + DuckDB
- 进程管理：PM2
- 反向代理：Nginx

---

## 服务器准备

### 1. 服务器配置要求

| 配置项 | 最低要求 | 推荐配置 |
|--------|----------|----------|
| CPU | 2 核 | 4 核 |
| 内存 | 4 GB | 8 GB |
| 硬盘 | 40 GB SSD | 80 GB SSD |
| 系统 | Ubuntu 20.04+ / CentOS 8+ | Ubuntu 22.04 |
| 带宽 | 5 Mbps | 10 Mbps |

### 2. 安装依赖（Ubuntu/Debian）

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装 Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 验证版本
node -v  # 应 >= 18.x
npm -v

# 安装 PM2
sudo npm install -g pm2

# 安装 Nginx
sudo apt install -y nginx

# 启动 Nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

### 3. 安装依赖（CentOS/RHEL）

```bash
# 安装 Node.js 20.x
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs

# 安装 PM2
sudo npm install -g pm2

# 安装 Nginx
sudo yum install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

### 4. 防火墙配置

```bash
# Ubuntu (ufw)
sudo ufw allow 80/tcp
sudo ufw allow 22/tcp
sudo ufw enable

# CentOS (firewalld)
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --reload
```

---

## 一键部署

### 步骤 1：上传项目

```bash
# 方式 A：通过 Git 克隆（推荐）
cd /tmp
git clone <你的仓库地址> chexian
cd chexian

# 方式 B：通过 SCP 上传
scp -r ./chexianYJFX root@YOUR_SERVER_IP:/tmp/chexian
ssh root@YOUR_SERVER_IP
cd /tmp/chexian
```

### 步骤 2：修改配置

```bash
# 编辑部署脚本，设置服务器 IP
nano deploy/deploy-fullstack.sh

# 找到这一行，修改为实际 IP
SERVER_IP="YOUR_SERVER_IP"
# 改为
SERVER_IP="192.168.1.100"  # 替换为实际 IP
```

### 步骤 3：运行部署

```bash
chmod +x deploy/deploy-fullstack.sh
./deploy/deploy-fullstack.sh
```

### 步骤 4：配置安全

```bash
# 修改 JWT 密钥（⚠️ 重要！）
nano /var/www/chexian/server/.env

# 将 JWT_SECRET 改为随机字符串（至少 64 字符）
# 可用命令生成：openssl rand -base64 48
```

### 步骤 5：上传数据

```bash
# 上传 Parquet 数据文件
scp 业务数据.parquet root@YOUR_SERVER_IP:/var/www/chexian/server/data/

# 重启后端加载数据
pm2 restart chexian-api
```

### 步骤 6：验证

打开浏览器访问 `http://YOUR_SERVER_IP/`

---

## 手动部署

如果一键脚本不适用，按以下步骤手动部署：

### 1. 创建目录

```bash
sudo mkdir -p /var/www/chexian/{frontend/dist,server/data}
sudo mkdir -p /var/log/chexian
sudo chown -R $(whoami):$(whoami) /var/www/chexian
sudo chown -R $(whoami):$(whoami) /var/log/chexian
```

### 2. 构建前端

```bash
cd /path/to/chexianYJFX
npm install  # 或 bun install
npm run build

# 复制构建产物
cp -r dist/* /var/www/chexian/frontend/dist/
```

### 3. 构建后端

```bash
cd /path/to/chexianYJFX/server
npm install
npm run build

# 复制后端文件
cp -r dist /var/www/chexian/server/
cp -r node_modules /var/www/chexian/server/
cp package.json ecosystem.config.cjs /var/www/chexian/server/

# 复制并修改环境配置
cp .env.production /var/www/chexian/server/.env
nano /var/www/chexian/server/.env  # 修改 JWT_SECRET
```

### 4. 配置 Nginx

```bash
# 复制配置文件
sudo cp deploy/nginx-fullstack.conf /etc/nginx/sites-available/chexian

# 修改服务器 IP
sudo sed -i 's/YOUR_SERVER_IP/192.168.1.100/g' /etc/nginx/sites-available/chexian

# 启用站点
sudo ln -s /etc/nginx/sites-available/chexian /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# 测试并重启
sudo nginx -t
sudo systemctl reload nginx
```

### 5. 启动后端

```bash
cd /var/www/chexian/server
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup  # 设置开机自启
```

---

## 配置说明

### 后端环境变量 (.env)

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NODE_ENV` | `production` | 环境标识 |
| `PORT` | `3000` | 后端端口 |
| `JWT_SECRET` | - | **必须修改**：JWT 签名密钥 |
| `JWT_EXPIRES_IN` | `24h` | Token 有效期 |
| `DATA_DIR` | `/var/www/chexian/server/data` | 数据目录 |
| `CORS_ORIGIN` | `http://YOUR_IP` | 允许的前端地址 |
| `LOG_LEVEL` | `info` | 日志级别 |

### Nginx 配置 (nginx-fullstack.conf)

| 配置项 | 位置 | 说明 |
|--------|------|------|
| `server_name` | 第 25 行 | 服务器 IP 或域名 |
| IP 白名单 | 第 28-33 行 | 允许访问的 IP 段 |
| `client_max_body_size` | 最后一行 | 上传文件大小限制 |

### 预设用户账号

| 用户名 | 密码 | 角色 | 权限 |
|--------|------|------|------|
| `admin` | `<在凭据库/E2E_PASSWORD 环境变量中获取>` | 管理员 | 查看所有数据 |
| `leshan` | `<在凭据库中获取>` | 三级机构 | 仅乐山数据 |
| `tianfu` | `<在凭据库中获取>` | 三级机构 | 仅天府数据 |
| ... | ... | ... | ... |

> ⚠️ **生产环境请修改默认密码！**

---

## 运维操作

### PM2 常用命令

```bash
# 查看状态
pm2 status

# 查看日志
pm2 logs chexian-api
pm2 logs chexian-api --lines 100  # 最近 100 行

# 重启服务
pm2 restart chexian-api

# 停止服务
pm2 stop chexian-api

# 监控
pm2 monit
```

### Nginx 常用命令

```bash
# 查看日志
tail -f /var/log/nginx/chexian_access.log
tail -f /var/log/nginx/chexian_error.log

# 重新加载配置
sudo nginx -t && sudo systemctl reload nginx

# 重启
sudo systemctl restart nginx
```

### 数据更新

```bash
# 上传新数据
scp 新数据.parquet root@SERVER:/var/www/chexian/server/data/

# 重启后端加载
pm2 restart chexian-api
```

### 备份

```bash
# 备份数据
cp /var/www/chexian/server/data/*.parquet /backup/$(date +%Y%m%d)/

# 备份配置
cp /var/www/chexian/server/.env /backup/$(date +%Y%m%d)/
```

---

## 故障排除

### 问题 1：后端启动失败

**症状**：`pm2 status` 显示 errored

**排查**：
```bash
pm2 logs chexian-api --lines 50
```

**常见原因**：
- 端口被占用：`lsof -i :3000`
- 缺少依赖：`cd /var/www/chexian/server && npm install`
- .env 配置错误：检查 JWT_SECRET 是否设置

### 问题 2：前端无法访问

**症状**：浏览器显示 502 Bad Gateway 或连接超时

**排查**：
```bash
# 检查 Nginx 状态
sudo systemctl status nginx

# 检查配置
sudo nginx -t

# 检查日志
tail -f /var/log/nginx/chexian_error.log
```

**常见原因**：
- IP 白名单限制：检查 nginx 配置中的 allow/deny
- 静态文件路径错误：检查 root 路径是否正确

### 问题 3：API 返回 401 Unauthorized

**症状**：登录后查询数据返回 401

**排查**：
```bash
# 检查 Token 是否有效
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3000/api/query/kpi
```

**常见原因**：
- Token 过期：重新登录
- JWT_SECRET 被修改：重启后端服务

### 问题 4：查询无数据

**症状**：登录成功但仪表盘显示空

**排查**：
```bash
# 检查数据文件
ls -la /var/www/chexian/server/data/

# 检查后端日志
pm2 logs chexian-api | grep -i "data\|load\|parquet"
```

**常见原因**：
- 数据文件未上传
- 数据文件格式错误
- 文件权限问题

### 问题 5：内存占用过高

**症状**：服务器响应缓慢，PM2 显示内存超限

**解决**：
```bash
# 重启后端释放内存
pm2 restart chexian-api

# 调整内存限制（ecosystem.config.cjs）
max_memory_restart: '2000M'  # 提高到 2GB
```

---

## 文件清单

```
deploy/
├── DEPLOY_FULLSTACK.md      # 本文档
├── deploy-fullstack.sh      # 一键部署脚本
├── nginx-fullstack.conf     # Nginx 前后端分离配置
├── nginx.conf               # Nginx 纯前端配置（旧）
├── docker-compose.yml       # Docker 部署（可选）
└── update-data.sh           # 数据更新脚本

server/
├── ecosystem.config.cjs     # PM2 配置
├── .env.production          # 环境变量模板
└── data/                    # 数据目录
    └── *.parquet            # Parquet 数据文件
```

---

## 联系支持

遇到问题请：
1. 查看本文档的故障排除部分
2. 检查 PM2 日志：`pm2 logs chexian-api`
3. 检查 Nginx 日志：`/var/log/nginx/chexian_error.log`
