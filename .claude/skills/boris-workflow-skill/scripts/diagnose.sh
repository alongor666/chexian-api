#!/bin/bash

# ============================================
# Boris Workflow 配置诊断脚本
# ============================================
# 
# 检查当前项目是否符合 Boris 工作流配置要求
#
# 使用方法：
#   ./diagnose.sh              # 在项目目录运行
#   ./diagnose.sh --fix        # 诊断并尝试修复
#   ./diagnose.sh --json       # JSON 格式输出
#
# ============================================

set -e

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 计分
SCORE=0
MAX_SCORE=0

# 检查函数
check() {
    local name="$1"
    local condition="$2"
    local weight="${3:-1}"
    local fix_hint="${4:-}"
    
    MAX_SCORE=$((MAX_SCORE + weight))
    
    if eval "$condition"; then
        echo -e "${GREEN}✅${NC} $name"
        SCORE=$((SCORE + weight))
        return 0
    else
        echo -e "${RED}❌${NC} $name"
        [ -n "$fix_hint" ] && echo -e "   ${CYAN}提示: $fix_hint${NC}"
        return 1
    fi
}

warn_check() {
    local name="$1"
    local condition="$2"
    
    if eval "$condition"; then
        echo -e "${GREEN}✅${NC} $name"
    else
        echo -e "${YELLOW}⚠️${NC} $name"
    fi
}

# 标题
echo ""
echo "============================================"
echo -e "${BLUE}  🔍 Boris Workflow 配置诊断${NC}"
echo "============================================"
echo ""
echo "项目: $(pwd)"
echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# ============================================
# 1. 基础检查
# ============================================
echo -e "${CYAN}## 基础配置${NC}"
echo ""

check "Git 仓库" "[ -d .git ]" 1 "运行 git init"

check "CLAUDE.md 存在" "[ -f CLAUDE.md ]" 2 "创建 CLAUDE.md 文件"

if [ -f CLAUDE.md ]; then
    CLAUDE_LINES=$(wc -l < CLAUDE.md)
    check "CLAUDE.md 内容充实 (>50行)" "[ $CLAUDE_LINES -gt 50 ]" 1 "添加更多规则和陷阱"
    
    warn_check "CLAUDE.md 包含代码规范" "grep -q '代码规范\|Code Style\|Coding Standard' CLAUDE.md"
    warn_check "CLAUDE.md 包含已知陷阱" "grep -q '陷阱\|Pitfall\|Gotcha\|已知问题' CLAUDE.md"
    warn_check "CLAUDE.md 包含项目术语" "grep -q '术语\|Terminology\|Glossary' CLAUDE.md"
fi

echo ""

# ============================================
# 2. Claude 配置目录
# ============================================
echo -e "${CYAN}## Claude 配置${NC}"
echo ""

check ".claude/ 目录存在" "[ -d .claude ]" 1 "创建 .claude/ 目录"

if [ -d .claude ]; then
    check "settings.json 存在" "[ -f .claude/settings.json ]" 1
    check "hooks.json 存在" "[ -f .claude/hooks.json ]" 1
    check "commands/ 目录存在" "[ -d .claude/commands ]" 1
    
    if [ -d .claude/commands ]; then
        CMD_COUNT=$(ls .claude/commands/*.md 2>/dev/null | wc -l)
        check "至少 3 个 slash commands" "[ $CMD_COUNT -ge 3 ]" 1
        
        echo ""
        echo "   已有 commands:"
        ls .claude/commands/*.md 2>/dev/null | while read f; do
            echo "   - $(basename $f .md)"
        done
    fi
fi

echo ""

# ============================================
# 3. Git Worktrees
# ============================================
echo -e "${CYAN}## Git Worktrees${NC}"
echo ""

if command -v git &> /dev/null; then
    WT_COUNT=$(git worktree list 2>/dev/null | wc -l)
    check "有多个 worktrees (>=2)" "[ $WT_COUNT -ge 2 ]" 1 "使用 git worktree add 创建"
    
    echo ""
    echo "   当前 worktrees:"
    git worktree list 2>/dev/null | while read line; do
        echo "   - $line"
    done
fi

echo ""

# ============================================
# 4. 推荐配置
# ============================================
echo -e "${CYAN}## 推荐配置${NC}"
echo ""

warn_check ".mcp.json 存在 (MCP集成)" "[ -f .mcp.json ]"
warn_check "package.json 有 format 脚本" "[ -f package.json ] && grep -q '\"format\"' package.json"
warn_check "package.json 有 lint 脚本" "[ -f package.json ] && grep -q '\"lint\"' package.json"
warn_check "package.json 有 test 脚本" "[ -f package.json ] && grep -q '\"test\"' package.json"

echo ""

# ============================================
# 5. CLAUDE.md 健康度
# ============================================
if [ -f CLAUDE.md ]; then
    echo -e "${CYAN}## CLAUDE.md 健康度${NC}"
    echo ""
    
    # 检查最后修改时间
    if [[ "$OSTYPE" == "darwin"* ]]; then
        LAST_MOD=$(stat -f %m CLAUDE.md)
        NOW=$(date +%s)
    else
        LAST_MOD=$(stat -c %Y CLAUDE.md)
        NOW=$(date +%s)
    fi
    
    DAYS_AGO=$(( (NOW - LAST_MOD) / 86400 ))
    
    if [ $DAYS_AGO -le 7 ]; then
        echo -e "${GREEN}✅${NC} 最近 7 天内有更新 ($DAYS_AGO 天前)"
    elif [ $DAYS_AGO -le 30 ]; then
        echo -e "${YELLOW}⚠️${NC} 最近 30 天内有更新 ($DAYS_AGO 天前)"
    else
        echo -e "${RED}❌${NC} 超过 30 天未更新 ($DAYS_AGO 天前)"
    fi
    
    # 统计内容
    echo ""
    echo "   内容统计:"
    echo "   - 总行数: $(wc -l < CLAUDE.md)"
    echo "   - 规则数: $(grep -c '^\s*-\s*\[' CLAUDE.md 2>/dev/null || echo 0)"
    echo "   - 表格数: $(grep -c '^|' CLAUDE.md 2>/dev/null || echo 0)"
fi

echo ""

# ============================================
# 结果汇总
# ============================================
echo "============================================"
echo -e "${BLUE}  📊 诊断结果${NC}"
echo "============================================"
echo ""

PERCENTAGE=$((SCORE * 100 / MAX_SCORE))

if [ $PERCENTAGE -ge 80 ]; then
    echo -e "配置完整度: ${GREEN}${SCORE}/${MAX_SCORE} (${PERCENTAGE}%)${NC}"
    echo -e "状态: ${GREEN}优秀${NC} ✨"
elif [ $PERCENTAGE -ge 60 ]; then
    echo -e "配置完整度: ${YELLOW}${SCORE}/${MAX_SCORE} (${PERCENTAGE}%)${NC}"
    echo -e "状态: ${YELLOW}良好${NC}"
else
    echo -e "配置完整度: ${RED}${SCORE}/${MAX_SCORE} (${PERCENTAGE}%)${NC}"
    echo -e "状态: ${RED}需要完善${NC}"
fi

echo ""

# 建议
if [ $PERCENTAGE -lt 100 ]; then
    echo "建议优先修复:"
    [ ! -f CLAUDE.md ] && echo "  1. 创建 CLAUDE.md"
    [ ! -d .claude ] && echo "  2. 创建 .claude/ 目录结构"
    [ ! -d .claude/commands ] && echo "  3. 添加 slash commands"
    WT_COUNT=$(git worktree list 2>/dev/null | wc -l)
    [ $WT_COUNT -lt 2 ] && echo "  4. 设置 git worktrees"
fi

echo ""
echo "============================================"
