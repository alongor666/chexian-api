# VPS 同步配置指南

## 流程概览

```
Windows: daily.mjs → Parquet 文件
    ↓
Windows: sync-vps.mjs → SSH 连接 → 上传 → 重启服务
    ↓
VPS: 数据更新完成
```

## 前置条件

### 1. SSH 密钥配置

**Windows 已完成：**
- ✅ 私钥: `C:\Users\xuechenglong\.ssh\chexian_deploy`
- ✅ 公钥: `C:\Users\xuechenglong\.ssh\chexian_deploy.pub`
- ✅ Config: `C:\Users\xuechenglong\.ssh\config`

**待完成：将公钥添加到 VPS**

### 2. 公钥内容

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJWBw54+ZDn8MxeKsjVc9qcZOck6/3L8lfF2yR/HSztl windows-chexian-deploy
```

---

## 配置方法

### 方法 A：通过 Mac 一键添加（推荐）

在 Mac 上执行以下命令：

```bash
ssh chexian-vps-deploy "echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJWBw54+ZDn8MxeKsjVc9qcZOck6/3L8lfF2yR/HSztl windows-chexian-deploy' >> ~/.ssh/authorized_keys && echo 'OK: Windows 公钥已添加'"
```

### 方法 B：通过腾讯云控制台

1. 访问 https://console.cloud.tencent.com/lighthouse
2. 找到实例 `龙腾云_2核4G` → 点击 **登录**
3. 选择 **VNC 登录**
4. 执行命令：

```bash
echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJWBw54+ZDn8MxeKsjVc9qcZOck6/3L8lfF2yR/HSztl windows-chexian-deploy' >> ~/.ssh/authorized_keys
```

---

## 验证流程

### Step 1: 验证 SSH 连接（Windows）

```powershell
node d:\chexian-api\scripts\sync-vps.mjs
```

预期输出：显示可同步的文件列表

### Step 2: 同步数据到 VPS

```powershell
# 同步最新数据
node d:\chexian-api\scripts\sync-vps.mjs

# 或预聚合模式（推荐，更省资源）
node d:\chexian-api\scripts\sync-vps.mjs --export
```

---

## 文件清单

| 文件 | 位置 | 用途 |
|------|------|------|
| `daily.mjs` | `数据管理/` | ETL 数据转换 |
| `sync-vps.mjs` | `scripts/` | VPS 同步 |
| `chexian_deploy` | `~/.ssh/` | SSH 私钥 |
| `chexian_deploy.pub` | `~/.ssh/` | SSH 公钥 |
| `config` | `~/.ssh/` | SSH 配置 |

---

## 故障排查

| 问题 | 解决方案 |
|------|----------|
| `Permission denied` | 公钥未添加到 VPS |
| `Connection refused` | VPS 端口未开放或服务未启动 |
| `Could not resolve hostname` | 网络问题或 DNS 解析失败 |
