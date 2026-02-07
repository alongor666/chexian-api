#!/bin/bash

# PostToolUse Hook - 自动格式化和质量检查
# 在 Claude 使用工具后自动运行

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}[PostToolUse]${NC} 运行自动化检查..."

# 检测项目类型
PROJECT_TYPE=""

if [ -f "pyproject.toml" ] || [ -f "requirements.txt" ]; then
    PROJECT_TYPE="python"
elif [ -f "package.json" ]; then
    PROJECT_TYPE="node"
fi

# Python 项目处理
if [ "$PROJECT_TYPE" = "python" ]; then
    echo -e "${GREEN}[Python]${NC} 检测到 Python 项目"
    
    # 查找所有修改的 Python 文件
    CHANGED_FILES=$(git diff --name-only --cached --diff-filter=ACM | grep '\.py$' || true)
    
    if [ -n "$CHANGED_FILES" ]; then
        echo -e "${GREEN}[Format]${NC} 格式化 Python 文件..."
        
        # Black 格式化
        if command -v black &> /dev/null; then
            echo "$CHANGED_FILES" | xargs black --quiet
            echo -e "${GREEN}✓${NC} Black 格式化完成"
        else
            echo -e "${YELLOW}⚠${NC} Black 未安装，跳过格式化"
        fi
        
        # isort 排序导入
        if command -v isort &> /dev/null; then
            echo "$CHANGED_FILES" | xargs isort --quiet
            echo -e "${GREEN}✓${NC} isort 导入排序完成"
        fi
        
        # Pylint 检查（仅警告）
        if command -v pylint &> /dev/null; then
            echo -e "${GREEN}[Lint]${NC} 运行 Pylint..."
            
            for file in $CHANGED_FILES; do
                pylint "$file" --errors-only || true
            done
            
            echo -e "${GREEN}✓${NC} Pylint 检查完成"
        fi
        
        # MyPy 类型检查（仅错误）
        if command -v mypy &> /dev/null; then
            echo -e "${GREEN}[Type]${NC} 运行类型检查..."
            
            for file in $CHANGED_FILES; do
                mypy "$file" --no-error-summary --show-error-codes || true
            done
            
            echo -e "${GREEN}✓${NC} MyPy 类型检查完成"
        fi
    else
        echo -e "${YELLOW}⚠${NC} 没有修改的 Python 文件"
    fi
fi

# Node.js 项目处理
if [ "$PROJECT_TYPE" = "node" ]; then
    echo -e "${GREEN}[Node.js]${NC} 检测到 Node.js 项目"
    
    # 查找所有修改的 TypeScript/JavaScript 文件
    CHANGED_FILES=$(git diff --name-only --cached --diff-filter=ACM | grep -E '\.(ts|tsx|js|jsx)$' || true)
    
    if [ -n "$CHANGED_FILES" ]; then
        echo -e "${GREEN}[Format]${NC} 格式化 TypeScript/JavaScript 文件..."
        
        # Prettier 格式化
        if command -v pnpm &> /dev/null && [ -f "package.json" ]; then
            echo "$CHANGED_FILES" | xargs pnpm prettier --write
            echo -e "${GREEN}✓${NC} Prettier 格式化完成"
        elif command -v npx &> /dev/null; then
            echo "$CHANGED_FILES" | xargs npx prettier --write
            echo -e "${GREEN}✓${NC} Prettier 格式化完成"
        else
            echo -e "${YELLOW}⚠${NC} Prettier 未安装，跳过格式化"
        fi
        
        # ESLint 检查
        if command -v pnpm &> /dev/null && [ -f "package.json" ]; then
            echo -e "${GREEN}[Lint]${NC} 运行 ESLint..."
            
            # 自动修复可修复的问题
            pnpm eslint --fix $CHANGED_FILES || true
            
            echo -e "${GREEN}✓${NC} ESLint 检查完成"
        fi
        
        # TypeScript 类型检查
        if [ -f "tsconfig.json" ] && command -v pnpm &> /dev/null; then
            echo -e "${GREEN}[Type]${NC} 运行 TypeScript 类型检查..."
            
            pnpm tsc --noEmit || true
            
            echo -e "${GREEN}✓${NC} TypeScript 类型检查完成"
        fi
    else
        echo -e "${YELLOW}⚠${NC} 没有修改的 TypeScript/JavaScript 文件"
    fi
fi

# 通用检查

# 检查是否有大文件
echo -e "${GREEN}[Size]${NC} 检查文件大小..."

LARGE_FILES=$(git diff --cached --name-only --diff-filter=ACM | while read file; do
    size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo 0)
    if [ "$size" -gt 1048576 ]; then  # 1MB
        echo "$file ($((size / 1024))KB)"
    fi
done)

if [ -n "$LARGE_FILES" ]; then
    echo -e "${YELLOW}⚠${NC} 发现大文件（>1MB）:"
    echo "$LARGE_FILES"
    echo -e "${YELLOW}建议使用 Git LFS 或压缩文件${NC}"
fi

# 检查敏感信息
echo -e "${GREEN}[Security]${NC} 扫描敏感信息..."

SENSITIVE_PATTERNS=(
    "password.*=.*['\"]"
    "api_key.*=.*['\"]"
    "secret.*=.*['\"]"
    "token.*=.*['\"]"
    "aws_access_key"
    "private_key"
)

for pattern in "${SENSITIVE_PATTERNS[@]}"; do
    matches=$(git diff --cached -G"$pattern" --name-only || true)
    if [ -n "$matches" ]; then
        echo -e "${RED}✗${NC} 可能包含敏感信息: $pattern"
        echo "  文件: $matches"
        echo -e "${YELLOW}请确认是否应该提交这些内容${NC}"
    fi
done

# 重新添加格式化后的文件
if [ "$PROJECT_TYPE" = "python" ] || [ "$PROJECT_TYPE" = "node" ]; then
    if [ -n "$CHANGED_FILES" ]; then
        echo -e "${GREEN}[Git]${NC} 重新添加格式化后的文件..."
        echo "$CHANGED_FILES" | xargs git add
        echo -e "${GREEN}✓${NC} 文件已重新添加"
    fi
fi

# 统计信息
TOTAL_FILES=$(git diff --cached --name-only --diff-filter=ACM | wc -l | tr -d ' ')
TOTAL_LINES=$(git diff --cached --shortstat | grep -oE '[0-9]+ insertions' | grep -oE '[0-9]+' || echo 0)
TOTAL_DELETIONS=$(git diff --cached --shortstat | grep -oE '[0-9]+ deletions' | grep -oE '[0-9]+' || echo 0)

echo ""
echo -e "${GREEN}[Summary]${NC} 变更统计:"
echo "  文件数: $TOTAL_FILES"
echo "  新增行: $TOTAL_LINES"
echo "  删除行: $TOTAL_DELETIONS"

echo ""
echo -e "${GREEN}[PostToolUse]${NC} 检查完成 ✓"

exit 0
