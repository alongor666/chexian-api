# 腾讯云轻量云服务器 (VPS) 指南

> 阿龙的 VPS 全貌，供 Claude Code 在各项目中安全使用。最后更新: 2026-02-20

---

## 基本信息

| 项目 | 值 |
|------|-----|
| 云厂商 | 腾讯云 (Tencent Cloud) |
| 产品 | 轻量应用服务器 (Lighthouse) |
| 实例 ID | `lhins-3mmzz0py` |
| 实例名称 | 龙腾云_2核4G |
| 地域 | 成都 (ap-chengdu, 成都一区) |
| 公网 IP | `162.14.113.44` |
| 内网 IP | `10.6.0.9` (hostname: `VM-0-9-opencloudos`) |
| 规格 | 2 vCPU (Xeon Platinum 8255C @ 2.5GHz) / 4GB RAM / 70GB SSD |
| 带宽 | 6Mbps (月流量 600GB, 每月重置) |
| 镜像 | **OpenClaw(Clawdbot)** 应用镜像 (预装 OpenClaw + Node.js) |
| 操作系统 | OpenCloudOS 9.4 (RHEL 兼容, x86_64) |
| 内核 | 6.6.117-45.1.oc9.x86_64 |
| 时区 | Asia/Beijing (CST, +0800) |
| Swap | 8GB (文件型) |
| SSH 密钥 ID | `lhkp-omlx56zu` |
| 到期时间 | 2027-02-13 22:41:32 (自动续费已开启) |
| 流量重置 | 每月 13 号 (下次: 2026-03-13) |
| DDoS 防护 | 基础防护 2Gbps |
| 主机安全 | 基础版 (有风险提示, 建议关注) |

### 备案域名

| 域名 | 备案 | 用途 |
|------|------|------|
| `cretvalu.com` | 腾讯云 ICP 备案 | 主域名 (已绑定 `@` 和 `www`) |
| `chexian.cretvalu.com` | (子域名, 随主域名) | 车险数据分析平台 |
| `wecom.cretvalu.com` | (子域名, 随主域名) | 企业微信回调 + API 代理 |

> 其他子域名可随时通过 DNS A 记录指向 VPS IP，无需额外备案。

---

## SSH 访问

```bash
# 从 Mac 连接 (更推荐使用 SSH 别名：ssh chexian-vps-deploy)
ssh -i ~/.ssh/chexian_deploy deployer@162.14.113.44
```

| 配置项 | 当前值 |
|--------|--------|
| 端口 | 22 (默认) |
| 认证方式 | 公钥 (ed25519) |
| 私钥位置 (Mac) | `~/.ssh/chexian_deploy` |
| 自动化用户 | `deployer` (配合 sudo wrapper 管理 PM2) |
| PermitRootLogin | yes |
| PasswordAuthentication | no (已彻底禁用密码登录) |

### 系统用户

| 用户 | UID | 用途 |
|------|-----|------|
| `root` | 0 | 主操作用户 |
| `lighthouse` | 1000 | 腾讯云默认用户 (未使用) |

---

## 资源使用概况 (截至 2026-02-14)

| 资源 | 总量 | 已用 | 可用 |
|------|------|------|------|
| 内存 | 3.6 GB | ~0.9 GB (25%) | ~2.7 GB |
| 磁盘 | 70 GB | 20 GB (28%) | 51 GB |
| 月流量 | 600 GB | < 0.1 GB | ~600 GB |

### 主要磁盘占用

| 目录 | 大小 | 内容 |
|------|------|------|
| `/root/.openclaw/` | 3.3 GB | OpenClaw 数据 + session 文件 |
| `/root/.nvm/` | 1.5 GB | Node.js v22.22.0 + npm 包 |
| 系统 + 工具 | ~15 GB | OS + Nginx + certbot + frp 等 |

---

## 已部署服务

### 服务清单

| 服务 | 管理方式 | 端口 | 绑定 | 用途 |
|------|----------|------|------|------|
| **Nginx** | systemd (`nginx.service`) | 80, 443 | 0.0.0.0 | HTTPS 反代, SSL 终止 |
| **chexian-api** | PM2 (`ecosystem.config.cjs`) | 3000 | 0.0.0.0 | 车险数据分析后端 API |
| **frps** | systemd (`frps.service`) | 7000, 18790 | 0.0.0.0 / * | frp 服务端 (Mac 内网穿透) |
| **OpenClaw Gateway** | systemd user (`openclaw-gateway.service`) | 18789, 18792 | 127.0.0.1 | AI agent 网关 |
| **sshd** | systemd | 22 | 0.0.0.0 | SSH 远程管理 |
| **certbot** | cron (每天 03:00) | - | - | SSL 证书自动续期 |

### 端口分配表

| 端口 | 协议 | 绑定 | 服务 | 备注 |
|------|------|------|------|------|
| 22 | TCP | 0.0.0.0 | sshd | SSH |
| 80 | TCP | 0.0.0.0 | Nginx | HTTP → 301 HTTPS |
| 443 | TCP | 0.0.0.0 | Nginx | HTTPS (SSL) |
| 3000 | TCP | 0.0.0.0 | chexian-api | 车险后端 API (仅 Nginx 反向代理，安全组已阻止外网) |
| 7000 | TCP | * | frps | frp 控制通道 |
| 18789 | TCP | 127.0.0.1 | OpenClaw Gateway | VPS 本地 OpenClaw (不对外) |
| 18790 | TCP | * | frps | frp 数据通道 → Mac OpenClaw |
| 18792 | TCP | 127.0.0.1 | OpenClaw Gateway | VPS OpenClaw 辅助端口 (dashboard/ws) |

### Nginx 配置

#### chexian.conf (车险平台)

位置: `/etc/nginx/conf.d/chexian.conf`
server_name: `chexian.cretvalu.com`

| location | 上游 | 用途 |
|----------|------|------|
| `/` | `/var/www/chexian/frontend/dist` | React SPA 静态文件 |
| `/api/` | `http://127.0.0.1:3000` | 后端 API 反向代理 |
| `/health` | `http://127.0.0.1:3000/health` | 健康检查 |

安全特性: IP 白名单 (`geo $allowed_ip`) + HTTPS 强制 + 安全头 (X-Frame-Options, HSTS 等)

#### wecom.conf (企业微信)

位置: `/etc/nginx/conf.d/wecom.conf`
server_name: `wecom.cretvalu.com`

| location | 上游 | 用途 |
|----------|------|------|
| `/wecom/` | `http://127.0.0.1:18790` | 企微回调 → frps → Mac |
| `/qyapi/` | `https://qyapi.weixin.qq.com` | 企微 API 代理 (出站 IP 固定) |
| `/` | 404 | 其他路径拒绝 |

> 新增站点: 在 `/etc/nginx/conf.d/` 创建新 `.conf` 文件，`nginx -t && systemctl reload nginx`。

### SSL 证书

| 域名 | 证书路径 | 签发方 | 有效期至 | 续期 |
|------|---------|--------|---------|------|
| `chexian.cretvalu.com` | `/etc/letsencrypt/live/chexian.cretvalu.com/` | Let's Encrypt | 2026-05-16 | certbot cron 自动 |
| `wecom.cretvalu.com` | `/etc/letsencrypt/live/wecom.cretvalu.com/` | Let's Encrypt | 2026-05-15 | certbot cron 自动 |

新增证书:
```bash
certbot --nginx -d NEW_SUBDOMAIN.cretvalu.com
```

### frp (内网穿透)

| 组件 | 位置 | 用途 |
|------|------|------|
| frps (服务端) | VPS | 接受 Mac frpc 连接 |
| frps 配置 | `/etc/frp/frps.toml` | 端口 7000, token 认证 |
| frps systemd | `/etc/systemd/system/frps.service` | 开机自启, RestartAlways |
| frps 日志 | `/var/log/frps.log` | 7 天轮转 |

> frp token 存储在 `/etc/frp/frps.toml` 和 Mac 端 `~/.openclaw/frpc.toml` 中。

### OpenClaw (VPS 实例, 应用镜像预装)

> VPS 使用腾讯云 **OpenClaw(Clawdbot) 应用镜像**购买，OpenClaw + Node.js + nvm 均为镜像预装，非手动部署。

| 项目 | 值 |
|------|-----|
| 版本 | 2026.2.9 (镜像预装版本, 可通过 `openclaw update` 升级) |
| Node.js | v22.22.0 (nvm, 镜像预装) |
| npm | 10.9.4 |
| 全局包 | openclaw@2026.2.9, clawhub@0.6.0, agent-browser@0.9.2 |
| 安装方式 | 应用镜像预装 (npm global) |
| 管理方式 | systemd user service (`/root/.config/systemd/user/openclaw-gateway.service`) |
| Gateway 端口 | 18789 (loopback) |
| 辅助端口 | 18792 (loopback, dashboard/ws) |
| Workspace | `/root/.openclaw/workspace/` |
| Agent | `main` (1 个) |
| 已安装扩展 | wecom, dingtalk, qqbot, adp-openclaw |

VPS OpenClaw 管理:
```bash
# 需先加载 nvm
source /root/.nvm/nvm.sh

openclaw status
openclaw gateway restart
openclaw logs --follow
```

---

## 软件环境

### 已安装工具

| 工具 | 版本 | 用途 |
|------|------|------|
| Node.js | v22.22.0 (nvm) | OpenClaw 运行时 |
| npm | 10.9.4 | 包管理 |
| Nginx | 1.26.3 | HTTP(S) 反代 |
| certbot | 2.8.0 | SSL 证书管理 |
| frps | 0.62.1 | frp 服务端 |
| PM2 | 5.x | Node.js 进程管理 |
| git | 2.43.7 | 版本控制 |
| Python 3 | 3.11.6 | 系统脚本 |
| curl | 8.4.0 | HTTP 测试 |
| wget | 1.21.3 | 文件下载 |

### 未安装 (可按需添加)

- Docker / Podman
- Go
- Rust
- PostgreSQL / MySQL / Redis

包管理器: `dnf` (RHEL 兼容)

---

## 防火墙与安全

### 当前状态

| 安全组件 | 状态 |
|----------|------|
| iptables | 无规则 (全部 ACCEPT) |
| firewalld | 未启用 |
| fail2ban | 未安装 |
| SELinux | (需确认) |
| 腾讯云安全组 | 由控制台管理 (防火墙模板) |
| DDoS 防护 | 基础防护 2Gbps |
| 主机安全 | 基础版 (控制台报「风险」, 建议查看处理) |
| 自动化助手 | 在线 |

> **重要**: VPS 的端口访问控制主要依赖**腾讯云控制台安全组 (防火墙)**，而非本机 iptables。安全组规则需在腾讯云 Lighthouse 控制台的「防火墙」页面配置。

### 安全注意事项

1. **SSH 已开启高强度防御** — PasswordAuthentication 已彻底禁用，仅允许秘钥登录。
2. **自动化强制使用 deployer 用户** — 不再使用 root 跑自动化。
3. **frp 控制端口 7000 对外开放** — 受 token 认证保护
4. **frp 数据端口 18790 对外开放** — 仅 frpc 客户端可连接
5. **OpenClaw 仅绑定 127.0.0.1** — 不可从外部直接访问

---

## 可用容量评估

| 维度 | 剩余 | 适合部署 |
|------|------|---------|
| CPU | ~2 核 (负载接近 0) | 轻量 Web 服务、CI runner、小型数据库 |
| 内存 | ~2.7 GB 可用 | 可再跑 2-3 个 Node.js 服务或 1 个小型数据库 |
| 磁盘 | 51 GB 可用 | 日志、数据库、静态资源 |
| 带宽 | 6Mbps / 月 600GB | 中等流量 Web 站点，不适合大文件分发 |

---

## 常用运维命令

```bash
# SSH 连接 (从 Mac)
ssh chexian-vps-deploy
# 或者
ssh -i ~/.ssh/chexian_deploy deployer@162.14.113.44

# 服务管理
systemctl status nginx frps
systemctl restart nginx
systemctl restart frps

# OpenClaw (需先 source nvm)
source /root/.nvm/nvm.sh && openclaw status

# Nginx
nginx -t                          # 测试配置
systemctl reload nginx            # 热重载
ls /etc/nginx/conf.d/             # 站点配置

# SSL
certbot certificates              # 查看已签发证书
certbot --nginx -d xxx.cretvalu.com  # 新增证书

# 日志
journalctl -u nginx --since today
journalctl -u frps --since today
cat /var/log/frps.log

# 资源监控
free -h && df -h / && uptime
ss -tlnp                         # 查看监听端口
```

---

## 新项目部署清单

在 VPS 上部署新服务时，参考以下步骤:

1. **选择端口** — 查看端口分配表，避免冲突。OpenClaw 用 18789/18790/18792，Nginx 用 80/443，frps 用 7000
2. **添加 DNS** — 在腾讯云 DNS 控制台为 `cretvalu.com` 添加 A 记录指向 `162.14.113.44`
3. **申请 SSL** — `certbot --nginx -d 新子域名.cretvalu.com`
4. **配置 Nginx** — 在 `/etc/nginx/conf.d/` 新建 `.conf`，proxy_pass 到本地端口
5. **创建 systemd 服务** — 确保开机自启 + 故障自动重启
6. **腾讯云安全组** — 如需对外开放新端口，在控制台添加规则

---

## 安全红线

以下内容**绝不可**出现在聊天输出、日志或公开仓库中:

- SSH 私钥 (`~/.ssh/chexian_deploy`)
- frp token (`/etc/frp/frps.toml` 中的 `auth.token`)
- OpenClaw gateway token (`openclaw-gateway.service` 中的 `OPENCLAW_GATEWAY_TOKEN`)
- OpenClaw 配置文件中的 API key 和 secret (`/root/.openclaw/openclaw.json`)
- 任何密码、凭据、access token

引用这些值时，只标注**文件路径和字段名**，不输出实际值。

---

## 车险数据分析平台部署状态

**部署时间**: 2026-02-14 | **最后更新**: 2026-02-20
**项目目录**: `/var/www/chexian/`
**访问地址**: `https://chexian.cretvalu.com`
**后端端口**: 3000 (监听 `0.0.0.0`，安全组已阻止外网直连)

### 使用指引

#### 访问方式

1. 浏览器打开 `https://chexian.cretvalu.com`
2. 使用账号密码登录（见下方账号清单）
3. 登录后自动进入仪表盘，可查看 KPI、趋势图、排名等

#### 访问限制

**当前策略（2026-02-24 更新）**: IP 白名单已移除，改为强密码认证。

> 原因：公司内网出口为中国电信动态 IP（ASN AS4134），无法用 CIDR 段精确限制，改为开放登录页 + 强密码保护。

| 层级 | 机制 | 说明 |
|------|------|------|
| Nginx | 无 IP 限制 | 任何 IP 均可访问登录页 |
| Express | loginLimiter 5次/分钟 | 防暴力破解 |
| 应用层 | JWT + 强密码 bcrypt | 唯一认证屏障 |

#### 账号清单 (13个用户)

| 用户名 | 密码 | 角色 | 数据范围 |
|--------|------|------|---------|
| `admin` | `CxAdmin@2026!` | branch_admin | 乐山全局（所有机构） |
| `leshan` | `CxLeshan@2026!` | org_user | 乐山 |
| `tianfu` | `CxTianfu@2026!` | org_user | 天府 |
| `yibin` | `CxYibin@2026!` | org_user | 宜宾 |
| `deyang` | `CxDeyang@2026!` | org_user | 德阳 |
| `xindu` | `CxXindu@2026!` | org_user | 新都 |
| `wuhou` | `CxWuhou@2026!` | org_user | 武侯 |
| `luzhou` | `CxLuzhou@2026!` | org_user | 泸州 |
| `zigong` | `CxZigong@2026!` | org_user | 自贡 |
| `ziyang` | `CxZiyang@2026!` | org_user | 资阳 |
| `dazhou` | `CxDazhou@2026!` | org_user | 达州 |
| `qingyang` | `CxQingyang@2026!` | org_user | 青羊 |
| `gaoxin` | `CxGaoxin@2026!` | org_user | 高新 |

**完整列表**: `server/src/services/auth.ts` → `PRESET_USERS`

### 当前状态 (2026-02-24 更新)

| 组件 | 状态 | 详情 |
|------|------|------|
| **后端服务 (PM2)** | ✅ 运行中 | 681,760 行数据已加载 |
| **HTTPS + SSL** | ✅ 正常 | Let's Encrypt, 有效期至 **2026-05-16** |
| **HTTP→HTTPS 重定向** | ✅ 正常 | 301 Moved Permanently |
| **Nginx IP 白名单** | ✅ 已移除 | 改为强密码认证，全网可访问登录页 |
| **审计日志** | ✅ 记录中 | `/var/www/chexian/logs/audit.log` |
| **API 登录** | ✅ 正常 | admin/CxAdmin@2026! → JWT Token |
| **KPI 查询** | ✅ 正常 | 总保费 5.17亿, 675,423件, 13机构, 332人 |
| **数据文件列表** | ✅ 正常 | `/api/data/files` 返回中文 Parquet 文件 |
| **端口 3000 外网** | ✅ 不可达 | 安全组已阻止外网直连 |
| **开机自启** | ✅ 已配置 | PM2 startup + save |
| **数据文件** | ✅ 已加载 | Parquet 24MB + DuckDB缓存 78MB (权限 600) |
| **自动备份** | ✅ 已配置 | cron 每天 02:00，保留 30 天 |
| **日志轮转** | ✅ 已配置 | logrotate: audit 90天, nginx 30天 |

**健康检查**: `curl http://localhost:3000/health` → `{"success":true,"message":"Server is running"}`

### 架构说明

```
用户浏览器 (任意IP)
  ↓ HTTPS :443
Nginx (SSL终止 + 安全头)
  ├─ /            → /var/www/chexian/frontend/dist  (React SPA)
  ├─ /api/        → proxy_pass http://127.0.0.1:3000  (反向代理)
  └─ /health      → proxy_pass http://127.0.0.1:3000/health
       ↓
PM2: chexian-api (Node.js v22 + Express)
  ├─ JWT 认证中间件 → 验证 Token
  ├─ 审计日志中间件 → 记录 /api/query/* 操作
  ├─ 权限中间件    → 按机构过滤数据 (RLS)
  └─ DuckDB 查询   → Parquet 文件 (675,423行保单)
```

### ⚠️ 安全问题与注意事项

#### 🔴 高优先级

| # | 问题 | 风险 | 状态 |
|---|------|------|------|
| 1 | **端口 3000 监听 `0.0.0.0`** | 若安全组误开端口，后端直接暴露 | ⚠️ 待修复：修改 `ecosystem.config.cjs` 设置 `HOST=127.0.0.1` |
| 2 | ~~所有密码均为弱密码~~ | ~~用户名+123，易被猜测~~ | ✅ 已修复（2026-02-24，升级为 `Cx{Username}@2026!`） |
| 3 | ~~DuckDB 缓存文件权限 644~~ | ~~任意用户可读~~ | ✅ 已修复（chmod 600） |
| 4 | ~~无自动备份~~ | ~~数据丢失无法恢复~~ | ✅ 已修复（cron 每天 02:00） |

#### 🟡 中优先级

| # | 问题 | 风险 | 状态 |
|---|------|------|------|
| 5 | ~~审计日志无轮转~~ | ~~持续增长占满磁盘~~ | ✅ 已修复（logrotate: audit 90天, nginx 30天） |
| 6 | **无 fail2ban** | SSH 暴力破解无防护 | ⚠️ 待修复：`dnf install fail2ban` |
| 7 | ~~SSH 密码认证可能未禁用~~ | ~~弱密码可被暴力破解~~ | ✅ 已修复：`PasswordAuthentication no` |
| 8 | ~~公网 IP 白名单会变~~ | ~~ISP 动态 IP，切换网络后无法访问~~ | ✅ 已移除白名单策略（2026-02-24） |
| 9 | **无 API 限流** | 恶意用户可高频请求 | ⚠️ 待修复：express-rate-limit |

#### 🟢 低优先级

| # | 问题 | 说明 |
|---|------|------|
| 10 | JWT Token 有效期 24 小时 | 生产环境建议缩短至 2-4 小时 |
| 11 | 无 HSTS preload | 当前 HSTS 仅在响应头，未提交到 preload 列表 |
| 12 | Nginx 版本暴露 | 响应头 `Server: nginx/1.26.3`，建议 `server_tokens off` |

#### 修复高优先级问题的命令

```bash
ssh chexian-vps-deploy

# --- 修复 #3: DuckDB 文件权限 ---
chmod 600 /var/www/chexian/server/data/chexian.duckdb*

# --- 修复 #4: 创建自动备份 ---
cat > /root/backup-chexian.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/var/backups/chexian/$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"
cp /var/www/chexian/server/data/*.parquet "$BACKUP_DIR/"
cp /var/www/chexian/server/data/*.json "$BACKUP_DIR/"
cp /var/www/chexian/server/.env "$BACKUP_DIR/"
cp /var/www/chexian/logs/audit.log "$BACKUP_DIR/"
find /var/backups/chexian/ -maxdepth 1 -mtime +30 -type d -exec rm -rf {} +
echo "[$(date)] Backup completed: $BACKUP_DIR"
EOF
chmod +x /root/backup-chexian.sh
echo "0 2 * * * /root/backup-chexian.sh >> /var/log/chexian-backup.log 2>&1" | crontab -

# --- 修复 #5: 审计日志轮转 ---
cat > /etc/logrotate.d/chexian << 'EOF'
/var/www/chexian/logs/audit.log {
    daily
    rotate 90
    compress
    delaycompress
    missingok
    notifempty
    create 0600 root root
}
/var/www/chexian/logs/nginx-*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    sharedscripts
    postrotate
        systemctl reload nginx > /dev/null 2>&1 || true
    endscript
}
EOF

# --- 修复 #12: 隐藏 Nginx 版本 ---
sed -i '/http {/a\    server_tokens off;' /etc/nginx/nginx.conf
nginx -t && systemctl reload nginx
```

### 审计日志

**路径**: `/var/www/chexian/logs/audit.log`
**格式**: JSON Lines（每行一条记录）
**记录范围**: 已认证用户的 `/api/query/*` 请求

**实际记录示例**:
```json
{
  "timestamp": "2026-02-15T11:45:08.339Z",
  "username": "admin",
  "userId": "admin",
  "role": "branch_admin",
  "ip": "::ffff:127.0.0.1",
  "method": "GET",
  "path": "/api/query/kpi",
  "query": {},
  "status": 200,
  "duration": 215
}
```

**查询命令**:
```bash
# 查看最近 20 条
tail -20 /var/www/chexian/logs/audit.log

# 格式化查看最新记录
tail -1 /var/www/chexian/logs/audit.log | python3 -m json.tool

# 统计各用户访问次数
cat /var/www/chexian/logs/audit.log | jq -r '.username' | sort | uniq -c | sort -rn

# 统计各 API 调用次数
cat /var/www/chexian/logs/audit.log | jq -r '.path' | sort | uniq -c | sort -rn

# 查看慢查询 (>5秒)
cat /var/www/chexian/logs/audit.log | jq 'select(.duration > 5000)'

# 按用户过滤
cat /var/www/chexian/logs/audit.log | jq 'select(.username == "admin")'
```

### 资源占用 (2026-02-15 实测)

| 资源 | 使用量 | 总量 | 占比 |
|------|--------|------|------|
| 内存 | ~204MB (PM2 进程) | 3.6GB | 5.5% |
| 磁盘 | ~172MB (项目目录) | 70GB | 0.2% |
| CPU | ~0% (空闲) | 2核 | 充足 |
| 带宽 | < 0.1GB | 600GB/月 | < 0.02% |

### 目录结构

```
/var/www/chexian/
├── frontend/
│   └── dist/               # React 构建产物
├── server/
│   ├── dist/               # 后端编译代码 (ES Module)
│   ├── data/               # 数据文件
│   │   ├── 车险保单综合明细表0212.parquet  (24MB, 权限 600)
│   │   ├── salesman_organization_mapping.json  (54KB, 权限 600)
│   │   ├── chexian.duckdb              (78MB, 权限 600 ✅)
│   │   └── chexian.duckdb.wal          (7.4KB, 权限 600 ✅)
│   ├── node_modules/       # 生产依赖
│   ├── .env                # 环境变量 (权限 600)
│   └── ecosystem.config.cjs  # PM2 配置
└── logs/                   # 日志目录 (权限 700)
    ├── nginx-access.log    # Nginx 访问日志
    ├── nginx-error.log     # Nginx 错误日志
    └── audit.log           # 审计日志 (权限 600)
```

### SSL 证书

| 域名 | 有效期至 | 签发方 | 自动续期 |
|------|---------|--------|---------|
| `chexian.cretvalu.com` | 2026-05-16 (89天) | Let's Encrypt | ✅ certbot timer |
| `wecom.cretvalu.com` | 2026-05-15 (88天) | Let's Encrypt | ✅ certbot timer |

**手动续期**: `certbot renew --force-renewal --cert-name chexian.cretvalu.com`
**查看状态**: `certbot certificates`
**自动续期检查**: `systemctl list-timers certbot.timer`

### 运维命令

```bash
# SSH 连接
ssh chexian-vps-deploy

# === PM2 管理 (需先加载 nvm) ===
source /root/.nvm/nvm.sh
pm2 status                    # 查看进程状态
pm2 logs chexian-api          # 实时日志
pm2 logs chexian-api --lines 50 --nostream  # 最近 50 行
pm2 restart chexian-api       # 重启
pm2 monit                     # 实时监控面板

# === Nginx ===
nginx -t                      # 测试配置
systemctl reload nginx        # 重载配置
tail -f /var/www/chexian/logs/nginx-access.log  # 访问日志

# === 审计日志 ===
tail -f /var/www/chexian/logs/audit.log
wc -l /var/www/chexian/logs/audit.log   # 总记录数

# === 健康检查 ===
curl -s http://localhost:3000/health
curl -sI https://chexian.cretvalu.com/  # HTTPS 状态

# === 手动备份 ===
/root/backup-chexian.sh       # 需先创建（见安全修复命令）
ls -lh /var/backups/chexian/

# === 一键同步数据（从本地 Mac 的 chexian-api 目录执行）===
# 自动找到最新 .parquet → 上传 → 设权限 600 → 重启 PM2 → 健康检查
./scripts/sync-vps.mjs

# === 更新代码（从本地 Mac 执行）===
# 1. 本地构建
bun run build
# 2. 打包上传
tar czf chexian-deploy.tar.gz dist/ server/dist/ server/package.json server/ecosystem.config.cjs
scp -i ~/.ssh/chexian_deploy chexian-deploy.tar.gz deployer@162.14.113.44:/tmp/
# 3. VPS 上解压并重启
ssh chexian-vps-deploy 'cd /var/www/chexian && tar xzf /tmp/chexian-deploy.tar.gz && sudo /usr/local/bin/deploy-chexian-api restart'
```

---

## GitHub Actions自动化部署与Runner配置

为了让云端 Runner（如 GitHub Actions）能安全连接到 VPS 执行推送和重启部署，需进行如下 Secret 配置：

1. **获取私钥**：在本地 Mac 执行 `cat ~/.ssh/chexian_deploy`
2. **配置 GitHub Secrets**：
   - 到 GitHub 仓库 `Settings` > `Secrets and variables` > `Actions` > `New repository secret`
   - **名称**: `VPS_SSH_KEY`
   - **内容**: 粘贴上面的私钥完整内容（包含 `-----BEGIN OPENSSH PRIVATE KEY-----` 和尾部标签）
3. **在 Action Workflow（如 `deploy.yml`）中使用**：
   通过类似于 `webfactory/ssh-agent` 或直接写入 `~/.ssh/chexian_deploy` 来注入凭据，同时通过 `deployer` 身份执行操作：
   ```yaml
   steps:
     - name: Setup SSH
       uses: webfactory/ssh-agent@v0.8.0
       with:
         ssh-private-key: ${{ secrets.VPS_SSH_KEY }}
     - name: Deploy
       run: |
         ssh -o StrictHostKeyChecking=no deployer@162.14.113.44 "sudo /usr/local/bin/deploy-chexian-api restart"
   ```

### 应急公网开放 Runbook（带自动回滚）

> 使用场景：白名单外临时访问、当天演示。默认策略应回归白名单。

```bash
# 1) 从本地上传最新脚本
scp -i ~/.ssh/chexian_deploy ./deploy/vps-deploy.mjs \
  deployer@162.14.113.44:/tmp/chexian-vps-deploy.mjs

# 2) 进入 VPS
ssh chexian-vps-deploy
sudo mv /tmp/chexian-vps-deploy.mjs /usr/local/bin/chexian-vps-deploy.mjs
sudo chmod 755 /usr/local/bin/chexian-vps-deploy.mjs

# 3) 应急开放（示例：到 2026-02-20 23:59 自动回滚）
bash /usr/local/bin/chexian-vps-deploy.mjs \
  --action emergency-open \
  --until "2026-02-20 23:59" \
  --basic-auth-user temp-access

# 4) 确认自动回滚任务
atq
```

**验证命令**：

```bash
# 开放后：预期 401（Basic Auth challenge）
curl -I https://chexian.cretvalu.com/

# 带 Basic Auth：预期 200（或前端入口正常）
curl -u temp-access:'<临时密码>' -I https://chexian.cretvalu.com/

# 到点回滚后：预期恢复 403（白名单生效）
curl -I https://chexian.cretvalu.com/
```

**提前手动回滚**：

```bash
bash /usr/local/bin/chexian-vps-deploy.mjs --action rollback-access
```

### 部署血泪教训

| 问题 | 根因 | 解决方案 |
|------|------|---------|
| **后端启动失败: Cannot find module** | TypeScript 编译 ESM 不自动添加 `.js` 扩展名 | 手动 sed 批量添加 `.js`；或修改 `tsconfig.json` 设置 `"moduleResolution": "NodeNext"` |
| **审计日志不记录** | ESM 模式下 `__dirname` 为 undefined | 使用 `fileURLToPath(import.meta.url)` + `path.dirname()` 替代 |
| **审计日志路径匹配失败** | Express 路由挂载后 `req.path` 变为相对路径（如 `/kpi`） | 使用 `req.originalUrl` 替代 `req.path` |
| **types 目录导入失败** | `from '../types.js'` 但 types 是目录 | 修改为 `from '../types/index.js'` |
| **Nginx 403 Forbidden** | VPS 本地 IP 不在白名单 | 白名单添加 `127.0.0.0/8` |
| **登录后无数据（"只有前端没有后端"）** | `sanitizeFilename()` 使用 ASCII-only 白名单 `/^[a-zA-Z0-9_\-\.]+$/`，拒绝中文文件名 `车险保单综合明细表0212.parquet` → `/api/data/files` 返回空数组 → 前端认为无数据 | 改为危险字符黑名单 `/[\/\\:<>\|"?\*\x00-\x1f]/`，允许中文字符通过 |

---

**最后更新**: 2026-02-24（移除 IP 白名单，升级全员强密码，补全 13 个用户）
