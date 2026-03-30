#!/bin/bash
# install.sh — 一键安装 deploy-chexian-api wrapper + sudoers 到 VPS
#
# 前置步骤 (从 Mac 执行):
#   ssh chexian-vps-deploy "sudo mkdir -p /root/deploy-tmp && sudo chmod 700 /root/deploy-tmp"
#   scp deploy/vps-wrapper/* chexian-vps-deploy:/root/deploy-tmp/
#   ssh chexian-vps-deploy "sudo bash /root/deploy-tmp/install.sh"
#   ssh chexian-vps-deploy "sudo rm -rf /root/deploy-tmp"
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WRAPPER_SRC="${SCRIPT_DIR}/deploy-chexian-api.sh"
WRAPPER_DST="/usr/local/bin/deploy-chexian-api"
SUDOERS_SRC="${SCRIPT_DIR}/deployer-pm2.sudoers"
SUDOERS_DST="/etc/sudoers.d/deployer-pm2"

# 安全: 禁止从 /tmp/ 安装，防止 TOCTOU 文件替换攻击
if [[ "$SCRIPT_DIR" == /tmp* ]]; then
  echo "错误: 禁止从 /tmp/ 安装，请将文件上传到 /root/deploy-tmp/" >&2
  exit 1
fi

echo "=== deploy-chexian-api 安装脚本 ==="
echo ""

# 0) 前置检查
if [ "$(id -u)" -ne 0 ]; then
  echo "错误: 请以 root 执行此脚本 (sudo bash $0)" >&2
  exit 1
fi

if ! id deployer >/dev/null 2>&1; then
  echo "错误: deployer 用户不存在，请先创建:" >&2
  echo "  useradd -m -s /bin/bash deployer" >&2
  echo "  mkdir -p /home/deployer/.ssh && cp ~/.ssh/authorized_keys /home/deployer/.ssh/" >&2
  exit 1
fi

# 1) 检查源文件
for f in "$WRAPPER_SRC" "$SUDOERS_SRC"; do
  if [ ! -f "$f" ]; then
    echo "错误: 找不到 $f" >&2
    echo "请先将 deploy/vps-wrapper/ 下的文件 scp 到 VPS" >&2
    exit 1
  fi
done

# 2) 安装 wrapper 脚本
echo "[1/4] 安装 wrapper 脚本 → $WRAPPER_DST"
cp "$WRAPPER_SRC" "$WRAPPER_DST"
chmod 755 "$WRAPPER_DST"
chown root:root "$WRAPPER_DST"
echo "  ✓ 已安装"

# 3) 验证并安装 sudoers
echo "[2/4] 验证 sudoers 语法..."
if ! visudo -cf "$SUDOERS_SRC"; then
  echo "  ✗ sudoers 语法错误！中止安装" >&2
  exit 1
fi
echo "  ✓ 语法正确"

cp "$SUDOERS_SRC" "$SUDOERS_DST"
chmod 440 "$SUDOERS_DST"
chown root:root "$SUDOERS_DST"
echo "  ✓ 已安装到 $SUDOERS_DST"

# 4) 验证 PM2 路径探测
echo "[3/4] 验证 PM2 路径探测..."
if "$WRAPPER_DST" help >/dev/null 2>&1 || true; then
  # wrapper 的 help 子命令会以 exit 1 退出，但如果路径探测失败会更早报错
  NVM_DIR="/root/.nvm"
  if [ -d "$NVM_DIR/versions/node" ]; then
    LATEST=$(ls -1 "$NVM_DIR/versions/node/" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)
    PM2_PATH="$NVM_DIR/versions/node/$LATEST/bin/pm2"
    if [ -x "$PM2_PATH" ]; then
      echo "  ✓ PM2 路径: $PM2_PATH"
    else
      echo "  ⚠ PM2 未在 $PM2_PATH 找到"
      echo "    请执行: which pm2 (以 root)"
      echo "    然后设置 NVM_BIN_DIR 环境变量"
    fi
  else
    echo "  ⚠ nvm 目录不存在: $NVM_DIR/versions/node"
    echo "    请手动确认 PM2 路径"
  fi
fi

# 5) 功能验证 — 用 help 子命令测试 sudo 权限，避免触发实际 PM2 操作
echo "[4/4] 验证 deployer sudo 权限..."
if su - deployer -s /bin/bash -c "sudo -n /usr/local/bin/deploy-chexian-api help" 2>&1 | grep -q "用法:"; then
  echo "  ✓ deployer 用户 sudo 权限正常"
else
  echo "  ⚠ 验证失败 — deployer 用户可能不存在或 sudo 配置未生效"
  echo "    手动验证: su - deployer -c 'sudo /usr/local/bin/deploy-chexian-api help'"
fi

echo ""
echo "=== 安装完成 ==="
echo ""
echo "使用方式 (从 Mac):"
echo "  ssh chexian-vps-deploy 'sudo /usr/local/bin/deploy-chexian-api status'"
echo "  ssh chexian-vps-deploy 'sudo /usr/local/bin/deploy-chexian-api logs 20'"
echo "  ssh chexian-vps-deploy 'sudo /usr/local/bin/deploy-chexian-api reload'"
