#!/bin/bash
# ============================================================
# 车险平台 - 本地开发环境初始化（新机器首次运行）
# ============================================================
# 用法（在项目根目录执行）：
#   bash scripts/setup-local-env.sh
#
# 功能：
#   1. 检查 SSH 私钥是否存在（~/.ssh/id_ed25519）
#   2. 写入 ~/.ssh/config 中的 chexian-vps 别名（幂等）
#   3. 验证 VPS 连通性
# ============================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

VPS_HOST="162.14.113.44"
VPS_USER="root"
SSH_KEY="$HOME/.ssh/id_ed25519"
SSH_CONFIG="$HOME/.ssh/config"
ALIAS="chexian-vps"

echo "=== 车险平台本地环境初始化 ==="
echo ""

# ── 步骤 1：检查私钥 ──────────────────────────────────────
if [ ! -f "$SSH_KEY" ]; then
    echo -e "${RED}✗ 私钥不存在: $SSH_KEY${NC}"
    echo ""
    echo "请将 id_ed25519 私钥放到 ~/.ssh/id_ed25519，步骤："
    echo "  1. 从密钥保管处取出 id_ed25519（私钥）"
    echo "  2. cp <私钥路径> ~/.ssh/id_ed25519"
    echo "  3. chmod 600 ~/.ssh/id_ed25519"
    echo "  4. 重新运行本脚本"
    echo ""
    echo "如果是首次配置新 VPS，生成新密钥对："
    echo "  ssh-keygen -t ed25519 -C 'chexian-deploy' -f ~/.ssh/id_ed25519"
    echo "  ssh-copy-id -i ~/.ssh/id_ed25519.pub root@${VPS_HOST}"
    exit 1
fi

chmod 600 "$SSH_KEY"
echo -e "${GREEN}✓ 私钥存在: $SSH_KEY${NC}"

# ── 步骤 2：写入 SSH config（幂等） ────────────────────────
mkdir -p "$HOME/.ssh"
touch "$SSH_CONFIG"
chmod 600 "$SSH_CONFIG"

if grep -q "Host $ALIAS" "$SSH_CONFIG" 2>/dev/null; then
    echo -e "${YELLOW}⊙ SSH config 已包含 $ALIAS 配置，跳过写入${NC}"
else
    cat >> "$SSH_CONFIG" << EOF

Host $ALIAS
    HostName $VPS_HOST
    User $VPS_USER
    IdentityFile $SSH_KEY
    ServerAliveInterval 60
EOF
    echo -e "${GREEN}✓ 已写入 ~/.ssh/config ($ALIAS 别名)${NC}"
fi

# ── 步骤 3：验证连通性 ─────────────────────────────────────
echo ""
echo -n "  验证 VPS 连通性... "
if ssh -o BatchMode=yes -o ConnectTimeout=10 "$ALIAS" true 2>/dev/null; then
    echo -e "${GREEN}ok${NC}"
    echo ""
    echo -e "${GREEN}=== 初始化完成 ===${NC}"
    echo "现在可以运行："
    echo "  ./deploy/sync-data.sh    # 同步 Parquet 到 VPS"
    echo "  ssh chexian-vps          # 连接 VPS"
else
    echo -e "${RED}失败${NC}"
    echo ""
    echo "连接失败，可能原因："
    echo "  1. 公钥未注册到 VPS：ssh-copy-id -i ${SSH_KEY}.pub ${VPS_USER}@${VPS_HOST}"
    echo "  2. VPS 防火墙拦截了本机 IP"
    echo "  3. VPS 已关机"
    exit 1
fi
