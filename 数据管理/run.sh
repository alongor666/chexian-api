#!/bin/bash
# 数据管理中心 - 统一执行脚本
# 用法: ./run.sh [command] [args...]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  数据管理中心 - $1${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo ""
}

print_usage() {
    echo "用法: ./run.sh [command] [options]"
    echo ""
    echo "命令:"
    echo "  transform   Excel → Parquet 转换"
    echo "  enrich      续保类型匹配增强"
    echo "  full        完整流程（enrich + transform）"
    echo "  help        显示帮助"
    echo ""
    echo "示例:"
    echo "  ./run.sh transform -i input.xlsx -o output.parquet"
    echo "  ./run.sh enrich --source hist.xlsx --target new.xlsx --output matched.xlsx"
    echo "  ./run.sh full --source hist.xlsx --target new.xlsx --output result.parquet"
    echo "  ./run.sh full --source hist.xlsx --target new.xlsx --output result.parquet --no-sync"
}

# 检查Python依赖
check_deps() {
    echo -e "${YELLOW}检查依赖...${NC}"
    python3 -c "import pandas, openpyxl, yaml, pyarrow" 2>/dev/null || {
        echo -e "${YELLOW}正在安装依赖...${NC}"
        pip3 install pandas openpyxl pyyaml pyarrow --user --break-system-packages -q 2>/dev/null || \
        pip3 install pandas openpyxl pyyaml pyarrow --user -q 2>/dev/null || \
        pip3 install pandas openpyxl pyyaml pyarrow -q
    }
    echo -e "${GREEN}依赖检查完成${NC}"
}

# 主逻辑
case "${1:-help}" in
    transform)
        print_header "Excel → Parquet 转换"
        check_deps
        shift
        python3 pipelines/transform.py "$@"
        ;;
    enrich)
        print_header "续保类型匹配增强"
        check_deps
        shift
        python3 pipelines/enrich.py "$@"
        ;;
    full)
        print_header "完整数据处理流程"
        check_deps
        shift
        # 解析参数
        SOURCE=""
        TARGET=""
        OUTPUT=""
        NO_SYNC="false"
        while [[ $# -gt 0 ]]; do
            case $1 in
                --source|-s) SOURCE="$2"; shift 2 ;;
                --target|-t) TARGET="$2"; shift 2 ;;
                --output|-o) OUTPUT="$2"; shift 2 ;;
                --no-sync) NO_SYNC="true"; shift ;;
                *) shift ;;
            esac
        done

        if [[ -z "$SOURCE" || -z "$TARGET" || -z "$OUTPUT" ]]; then
            echo -e "${RED}错误: 完整流程需要 --source, --target, --output 参数${NC}"
            exit 1
        fi

        # 中间文件
        STAGING_FILE="staging/$(basename "${TARGET%.*}")_已匹配.xlsx"

        echo -e "${BLUE}步骤 1/2: 续保类型匹配${NC}"
        python3 pipelines/enrich.py --source "$SOURCE" --target "$TARGET" --output "$STAGING_FILE"

        echo ""
        echo -e "${BLUE}步骤 2/2: 转换为 Parquet${NC}"
        python3 pipelines/transform.py -i "$STAGING_FILE" -o "$OUTPUT"

        echo ""
        echo -e "${GREEN}✅ 完整流程执行完成！${NC}"
        echo -e "输出文件: ${OUTPUT}"

        # 步骤 3/3: 自动同步到 VPS（可用 --no-sync 跳过）
        if [[ "$NO_SYNC" != "true" ]]; then
            SYNC_SCRIPT="$(dirname "$SCRIPT_DIR")/deploy/sync-data.sh"
            if [[ -f "$SYNC_SCRIPT" ]]; then
                echo ""
                echo -e "${BLUE}步骤 3/3: 同步 Parquet 到 VPS${NC}"
                bash "$SYNC_SCRIPT" "$OUTPUT"
            else
                echo -e "${YELLOW}⚠ 未找到 sync-data.sh，跳过 VPS 同步${NC}"
                echo -e "  手动同步: ./deploy/sync-data.sh ${OUTPUT}"
            fi
        else
            echo -e "${YELLOW}已跳过 VPS 同步（--no-sync）${NC}"
        fi
        ;;
    help|--help|-h)
        print_header "帮助"
        print_usage
        ;;
    *)
        echo -e "${RED}未知命令: $1${NC}"
        print_usage
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  处理完成!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
