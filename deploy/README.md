# 车险业务分析系统 - 内网部署指南

> **⚠️ 本文档为旧版纯前端部署指南，已不适用于当前架构。**
> 当前生产部署请参考 [DEPLOY_FULLSTACK.md](./DEPLOY_FULLSTACK.md)。
> 数据同步使用 `node scripts/sync-vps.mjs`，数据目录为 `server/data/fact/policy/current/`。

## 快速开始（3步完成）

### 方式一：本地预览（最快体验）

```bash
# 在项目根目录执行
cd /Users/xuechenglong/Downloads/01-正开发Git项目/chexianYJFX

# 构建并预览
bun run build && bun run preview
```

访问 http://localhost:4173 即可预览（需手动上传数据）。

### 方式二：Docker 部署（推荐）

```bash
# 一键启动
docker-compose up -d

# 访问
http://localhost:8080
```

### 方式三：传统 Nginx 部署

```bash
# 执行部署脚本
./deploy/deploy.sh
```

---

## 详细部署步骤

### 1. 环境要求

| 组件 | 版本要求 | 说明 |
|------|---------|------|
| Bun | >= 1.0 | 构建工具 |
| Nginx | >= 1.18 | Web 服务器 |
| 操作系统 | Linux/macOS | Windows 需要 WSL |

### 2. 构建项目

```bash
# 进入项目目录
cd /path/to/chexianYJFX

# 安装依赖
bun install

# 生产构建
bun run build
```

构建产物在 `dist/` 目录。

### 3. 服务器部署

#### 3.1 创建目录结构

```bash
# 在服务器上执行
sudo mkdir -p /var/www/chexian/frontend/dist
sudo mkdir -p /var/www/chexian/shared-data
sudo chown -R $(whoami):$(whoami) /var/www/chexian
```

#### 3.2 上传文件

```bash
# 从本地上传构建产物
scp -r dist/* user@server:/var/www/chexian/frontend/dist/

# 上传数据文件
scp 业务数据.parquet user@server:/var/www/chexian/shared-data/业务数据.parquet
```

#### 3.3 配置 Nginx

```bash
# 复制配置文件
sudo cp deploy/nginx.conf /etc/nginx/sites-available/chexian

# 编辑配置，修改 server_name
sudo nano /etc/nginx/sites-available/chexian
# 将 192.168.1.100 改为实际内网IP

# 启用站点
sudo ln -s /etc/nginx/sites-available/chexian /etc/nginx/sites-enabled/

# 测试并重启
sudo nginx -t && sudo systemctl reload nginx
```

### 4. 访问测试

打开浏览器访问：`http://<内网IP>/`

- 首次访问会自动加载服务器上的共享数据
- 加载成功后自动跳转到仪表盘

---

## 目录结构

```
/var/www/chexian/
├── dist/                    # 前端静态文件
│   ├── index.html
│   ├── assets/
│   └── ...
└── shared-data/             # 共享数据目录
    ├── 业务数据.parquet     # 主数据文件（必需）
    └── backups/             # 数据备份（可选）
```

---

## 数据管理

### 更新数据

```bash
# 方式1：使用脚本（推荐）
./deploy/update-data.sh /path/to/新数据.parquet --backup

# 方式2：手动复制
scp 新数据.parquet user@server:/var/www/chexian/shared-data/业务数据.parquet
```

### 数据备份

```bash
# 备份目录
/var/www/chexian/shared-data/backups/

# 手动备份
cp /var/www/chexian/shared-data/业务数据.parquet \
   /var/www/chexian/shared-data/backups/业务数据.$(date +%Y%m%d).parquet
```

### 定时更新（可选）

```bash
# 添加 cron 任务，每天凌晨2点更新数据
crontab -e

# 添加以下行
0 2 * * * /var/www/chexian/deploy/update-data.sh /path/to/daily-export.parquet --backup
```

---

## 安全配置

### 内网限制

Nginx 配置已包含 IP 白名单：

```nginx
allow 192.168.0.0/16;    # 192.168.x.x 网段
allow 10.0.0.0/8;        # 10.x.x.x 网段
allow 172.16.0.0/12;     # 172.16.x.x - 172.31.x.x 网段
deny all;                # 拒绝其他所有IP
```

### 添加密码保护（可选）

```bash
# 创建密码文件
sudo htpasswd -c /etc/nginx/.htpasswd admin

# 在 nginx.conf 的 location / 中添加
auth_basic "内部系统";
auth_basic_user_file /etc/nginx/.htpasswd;
```

### 集成企业 LDAP（高级）

参考 `nginx.conf` 中的注释部分。

---

## 故障排除

### 问题1：数据加载失败

**症状**：页面显示"自动加载数据失败"

**解决**：
```bash
# 检查数据文件是否存在
ls -la /var/www/chexian/shared-data/业务数据.parquet

# 检查文件权限
chmod 644 /var/www/chexian/shared-data/业务数据.parquet

# 检查 Nginx 错误日志
tail -f /var/log/nginx/chexian_error.log
```

### 问题2：页面空白或报错

**症状**：控制台显示 SharedArrayBuffer 错误

**解决**：确保 Nginx 配置包含以下头：
```nginx
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Embedder-Policy "require-corp" always;
```

### 问题3：无法访问

**症状**：连接被拒绝

**解决**：
```bash
# 检查 Nginx 状态
sudo systemctl status nginx

# 检查端口监听
sudo netstat -tlnp | grep 80

# 检查防火墙
sudo ufw status
sudo ufw allow 80/tcp
```

---

## 配置说明

### 环境变量（.env.production）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VITE_AUTO_LOAD_DATA` | `true` | 是否自动加载服务器数据 |
| `VITE_DATA_URL` | `/data/业务数据.parquet` | 数据文件路径 |
| `VITE_APP_TITLE` | `车险业务分析系统（内网版）` | 页面标题 |

### 自定义数据路径

修改 `.env.production`：

```bash
VITE_DATA_URL=/data/custom-data.parquet
```

然后重新构建：`bun run build`

---

## 文件清单

```
deploy/
├── README.md           # 本文档
├── nginx.conf          # Nginx 配置模板
├── deploy.sh           # 一键部署脚本
├── update-data.sh      # 数据更新脚本
└── docker-compose.yml  # Docker 部署配置（待创建）
```

---

## 技术支持

遇到问题请：
1. 查看本文档的故障排除部分
2. 检查 Nginx 错误日志：`/var/log/nginx/chexian_error.log`
3. 检查浏览器控制台错误信息
