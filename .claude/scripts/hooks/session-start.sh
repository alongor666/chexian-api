#!/bin/bash

# SessionStart Hook - 会话初始化与环境验证
# 支持 & 符号移交到 Web 和 --teleport 切换
#
# 功能：
# 1. 验证项目环境
# 2. 检查依赖状态
# 3. 输出会话上下文
# 4. 支持从 GitHub Actions 恢复会话

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 获取脚本目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${NC}       ${GREEN}🚀 Claude Code Session Start${NC}                          ${CYAN}║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# 生成会话 ID
SESSION_ID="session_$(date +%Y%m%d_%H%M%S)_$(openssl rand -hex 4 2>/dev/null || echo $RANDOM)"
export CLAUDE_SESSION_ID="$SESSION_ID"

echo -e "${BLUE}[Session]${NC} ID: ${YELLOW}$SESSION_ID${NC}"
echo ""

# ============================================================
# 1. 环境检查
# ============================================================

echo -e "${GREEN}[1/5]${NC} 环境检查..."

# 检查是否在 GitHub Actions 中
if [ -n "$GITHUB_ACTIONS" ]; then
    echo -e "  ${CYAN}→${NC} 运行环境: ${YELLOW}GitHub Actions${NC}"
    echo -e "  ${CYAN}→${NC} 仓库: ${GITHUB_REPOSITORY}"
    echo -e "  ${CYAN}→${NC} 分支: ${GITHUB_REF_NAME}"
    echo -e "  ${CYAN}→${NC} 触发事件: ${GITHUB_EVENT_NAME}"

    # 检查是否有继续会话
    if [ -n "$INPUT_SESSION_ID" ]; then
        echo -e "  ${CYAN}→${NC} 继续会话: ${YELLOW}$INPUT_SESSION_ID${NC} (teleport)"
    fi
else
    echo -e "  ${CYAN}→${NC} 运行环境: ${YELLOW}本地终端${NC}"
fi

# 检查 Git 状态
if git rev-parse --is-inside-work-tree &>/dev/null; then
    BRANCH=$(git branch --show-current 2>/dev/null || echo "detached")
    COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    CHANGES=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

    echo -e "  ${CYAN}→${NC} Git 分支: ${YELLOW}$BRANCH${NC} @ $COMMIT"

    if [ "$CHANGES" -gt 0 ]; then
        echo -e "  ${CYAN}→${NC} 未提交变更: ${YELLOW}$CHANGES 个文件${NC}"
    else
        echo -e "  ${CYAN}→${NC} 工作区: ${GREEN}干净${NC}"
    fi
else
    echo -e "  ${YELLOW}⚠${NC} 不在 Git 仓库中"
fi

echo ""

# ============================================================
# 2. 依赖检查
# ============================================================

echo -e "${GREEN}[2/5]${NC} 依赖检查..."

# 检查 Bun
if command -v bun &>/dev/null; then
    BUN_VERSION=$(bun --version 2>/dev/null || echo "unknown")
    echo -e "  ${GREEN}✓${NC} Bun: v$BUN_VERSION"
else
    echo -e "  ${RED}✗${NC} Bun 未安装"
    echo -e "    ${YELLOW}安装: curl -fsSL https://bun.sh/install | bash${NC}"
fi

# 检查 Node.js（作为备选）
if command -v node &>/dev/null; then
    NODE_VERSION=$(node --version 2>/dev/null || echo "unknown")
    echo -e "  ${GREEN}✓${NC} Node.js: $NODE_VERSION"
fi

# 检查 node_modules
if [ -d "$PROJECT_ROOT/node_modules" ]; then
    MODULE_COUNT=$(ls "$PROJECT_ROOT/node_modules" 2>/dev/null | wc -l | tr -d ' ')
    echo -e "  ${GREEN}✓${NC} node_modules: $MODULE_COUNT 个包"
else
    echo -e "  ${YELLOW}⚠${NC} node_modules 不存在，需要运行 ${CYAN}bun install${NC}"
fi

echo ""

# ============================================================
# 3. 项目状态
# ============================================================

echo -e "${GREEN}[3/5]${NC} 项目状态..."

# 检查关键文件
KEY_FILES=(
    "CLAUDE.md"
    "package.json"
    "tsconfig.json"
    "vite.config.ts"
    "BACKLOG.md"
    "PROGRESS.md"
)

for file in "${KEY_FILES[@]}"; do
    if [ -f "$PROJECT_ROOT/$file" ]; then
        echo -e "  ${GREEN}✓${NC} $file"
    else
        echo -e "  ${YELLOW}⚠${NC} $file (缺失)"
    fi
done

echo ""

# ============================================================
# 4. 快速测试验证
# ============================================================

echo -e "${GREEN}[4/5]${NC} 快速验证..."

# 如果在 GitHub Actions 中或有 node_modules，运行快速测试
if [ -d "$PROJECT_ROOT/node_modules" ]; then
    cd "$PROJECT_ROOT"

    # TypeScript 类型检查（快速模式）
    if [ -f "tsconfig.json" ]; then
        if timeout 30 bun run tsc --noEmit --skipLibCheck 2>/dev/null; then
            echo -e "  ${GREEN}✓${NC} TypeScript 类型检查通过"
        else
            echo -e "  ${YELLOW}⚠${NC} TypeScript 类型检查有警告（可忽略）"
        fi
    fi

    # 治理检查
    if [ -f "scripts/check-governance.mjs" ]; then
        if bun run governance 2>/dev/null; then
            echo -e "  ${GREEN}✓${NC} 治理检查通过"
        else
            echo -e "  ${YELLOW}⚠${NC} 治理检查有发现"
        fi
    fi
else
    echo -e "  ${YELLOW}⚠${NC} 跳过验证（无 node_modules）"
fi

echo ""

# ============================================================
# 5. 会话信息输出
# ============================================================

echo -e "${GREEN}[5/5]${NC} 会话准备就绪"
echo ""

# 输出会话上下文到环境变量
cat << EOF > "$PROJECT_ROOT/.claude/session-context.json"
{
  "session_id": "$SESSION_ID",
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "environment": "${GITHUB_ACTIONS:-local}",
  "git": {
    "branch": "${BRANCH:-unknown}",
    "commit": "${COMMIT:-unknown}",
    "changes": ${CHANGES:-0}
  },
  "project": {
    "name": "chexianYJFX",
    "type": "react-typescript",
    "package_manager": "bun"
  }
}
EOF

echo -e "${CYAN}┌──────────────────────────────────────────────────────────┐${NC}"
echo -e "${CYAN}│${NC} ${GREEN}Session Ready${NC}                                            ${CYAN}│${NC}"
echo -e "${CYAN}├──────────────────────────────────────────────────────────┤${NC}"
echo -e "${CYAN}│${NC} Session ID: ${YELLOW}$SESSION_ID${NC}"
echo -e "${CYAN}│${NC}"
echo -e "${CYAN}│${NC} ${BLUE}移交到 Web:${NC}"
echo -e "${CYAN}│${NC}   输入 ${YELLOW}&${NC} 获取移交链接"
echo -e "${CYAN}│${NC}"
echo -e "${CYAN}│${NC} ${BLUE}切换到云端:${NC}"
echo -e "${CYAN}│${NC}   运行 ${YELLOW}claude --teleport${NC}"
echo -e "${CYAN}│${NC}"
echo -e "${CYAN}│${NC} ${BLUE}在 PR 中继续:${NC}"
echo -e "${CYAN}│${NC}   ${YELLOW}@claude continue session_id=$SESSION_ID${NC}"
echo -e "${CYAN}└──────────────────────────────────────────────────────────┘${NC}"
echo ""

# 输出 CLAUDE.md 关键提醒
echo -e "${YELLOW}📖 关键提醒（来自 CLAUDE.md）:${NC}"
echo -e "  • 使用 ${CYAN}Bun${NC} 包管理器（禁止 npm/yarn）"
echo -e "  • 提交前运行 ${CYAN}bun run governance${NC}"
echo -e "  • 查看 §2.5 实现前检查协议"
echo -e "  • 遵循三大索引定位机制"
echo ""

exit 0
