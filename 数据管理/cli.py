#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据分析工具库统一CLI入口

提供工具列表、搜索、运行等功能，建立可发现、可搜索、结构化的工具调用体系。

使用示例:
    python3 cli.py --list                    # 列出所有工具
    python3 cli.py --list data-tools         # 列出数据分析工具
    python3 cli.py --search parquet          # 搜索工具
    python3 cli.py analyze_parquet           # 运行工具
    python3 cli.py --check                   # 检查元数据

分类:
    - data-tools: 数据分析工具（Parquet分析、Excel分析、深度探索）
    - field-tools: 字段分析工具（关联分析、深度分析、穷举分析）
    - conversion-tools: 数据转换工具（Excel→Parquet）
    - business-tools: 业务计算工具（已赚保费计算）

版本: 1.0.0
作者: "@claude"
最后更新: 2026-01-16
"""

import argparse
import sys
import importlib.util
from pathlib import Path
from typing import Dict, List, Optional, Any
import json


# ============================================================================
# 工具注册表 (TOOL_REGISTRY)
# ============================================================================
# 所有工具的元数据注册表，包含模块路径、功能描述、分类等信息
# ============================================================================

TOOL_REGISTRY: Dict[str, Dict[str, Any]] = {
    # ============ 数据分析工具 (data-tools) ============
    "analyze_parquet": {
        "module": "data_tools.analyze_parquet",
        "function": "main",
        "category": "data-tools",
        "description": "Parquet文件结构分析，显示数据维度、字段信息、统计摘要",
        "tags": ["analysis", "parquet", "data-quality"],
        "version": "1.0.0",
        "author": "@claude",
    },
    "analyze_excel": {
        "module": "data_tools.analyze_excel",
        "function": "main",
        "category": "data-tools",
        "description": "Excel文件结构分析，显示工作表、字段类型、数据分布",
        "tags": ["analysis", "excel", "data-quality"],
        "version": "1.0.0",
        "author": "@claude",
    },
    "deep_analysis": {
        "module": "data_tools.deep_analysis",
        "function": "main",
        "category": "data-tools",
        "description": "深度数据探索，多维度分析、关联性探索、异常检测",
        "tags": ["analysis", "exploration", "statistics"],
        "version": "1.0.0",
        "author": "@claude",
    },

    # ============ 字段分析工具 (field-tools) ============
    "field_relation": {
        "module": "field_tools.field_relation",
        "function": "main",
        "category": "field-tools",
        "description": "字段关联分析，探索字段间的相关性和依赖关系",
        "tags": ["fields", "correlation", "relationship"],
        "version": "1.0.0",
        "author": "@claude",
    },
    "field_deep": {
        "module": "field_tools.field_deep",
        "function": "main",
        "category": "field-tools",
        "description": "字段深度分析，单个字段的数据分布、质量、特征分析",
        "tags": ["fields", "quality", "distribution"],
        "version": "1.0.0",
        "author": "@claude",
    },
    "field_exhaustive": {
        "module": "field_tools.field_exhaustive",
        "function": "main",
        "category": "field-tools",
        "description": "字段穷举分析，全面分析所有字段的统计特征",
        "tags": ["fields", "statistics", "exhaustive"],
        "version": "1.0.0",
        "author": "@claude",
    },

    # ============ 数据转换工具 (conversion-tools) ============
    "excel_to_parquet": {
        "module": "conversion_tools.excel_to_parquet",
        "function": "main",
        "category": "conversion-tools",
        "description": "Excel转Parquet格式，支持字段映射、数据清洗、去重策略",
        "tags": ["conversion", "excel", "parquet", "etl"],
        "version": "1.0.0",
        "author": "@claude",
    },

    # ============ 诊断工具 (diagnosis-tools) ============
    "diagnose_agent": {
        "module": "pipelines.diagnose_agent",
        "function": "main",
        "category": "diagnosis-tools",
        "description": "经代/代理公司经营KPI诊断（满期赔付率/变动成本率/费用率/出险率，分年对比）",
        "tags": ["diagnosis", "agent", "kpi", "intermediary", "earned-premium"],
        "version": "1.0.0",
        "author": "@claude",
    },

    # ============ 业务计算工具 (business-tools) ============
    "earned_premium": {
        "module": "business_tools.earned_premium.calculate",
        "function": "main",
        "category": "business-tools",
        "description": "已赚保费计算，基于保险期限按比例计算已赚保费",
        "tags": ["business", "premium", "calculation"],
        "version": "1.0.0",
        "author": "@claude",
    },
}


# ============================================================================
# 分类定义
# ============================================================================

CATEGORIES: Dict[str, str] = {
    "data-tools": "数据分析工具",
    "field-tools": "字段分析工具",
    "conversion-tools": "数据转换工具",
    "business-tools": "业务计算工具",
}


# ============================================================================
# CLI 核心功能
# ============================================================================

def list_tools(category: Optional[str] = None) -> None:
    """
    列出所有工具，支持按分类过滤

    Args:
        category: 可选的分类过滤器（如 "data-tools"）
    """
    print("\n" + "=" * 80)
    print("📋 数据分析工具库 - 工具列表")
    print("=" * 80)

    if category:
        if category not in CATEGORIES:
            print(f"\n❌ 未知的分类: {category}")
            print(f"\n可用分类: {', '.join(CATEGORIES.keys())}")
            return

        tools = [ (name, meta) for name, meta in TOOL_REGISTRY.items()
                 if meta["category"] == category ]
        print(f"\n分类: {CATEGORIES[category]} ({len(tools)} 个工具)")
    else:
        tools = list(TOOL_REGISTRY.items())
        print(f"\n总计: {len(tools)} 个工具")

    print("-" * 80)

    # 表格化输出
    print(f"{'工具名':<25} {'分类':<20} {'描述'}")
    print("-" * 80)

    for tool_name, meta in sorted(tools):
        cat_display = meta["category"] or "未分类"
        desc = meta.get("description", "无描述")
        print(f"{tool_name:<25} {cat_display:<20} {desc}")

    print("=" * 80)

    # 统计信息
    if not category:
        print("\n📊 按分类统计:")
        print("-" * 80)
        for cat_id, cat_name in CATEGORIES.items():
            count = sum(1 for meta in TOOL_REGISTRY.values()
                       if meta["category"] == cat_id)
            print(f"{cat_name:<20} {count} 个工具")
        print("=" * 80)


def search_tools(keyword: str) -> None:
    """
    搜索工具（名称、描述、分类、标签）

    Args:
        keyword: 搜索关键词
    """
    keyword_lower = keyword.lower()
    results = []

    for tool_name, meta in TOOL_REGISTRY.items():
        score = 0

        # 名称匹配（权重最高）
        if keyword_lower in tool_name.lower():
            score += 10

        # 分类匹配
        if meta["category"] and keyword_lower in meta["category"].lower():
            score += 5

        # 描述匹配
        description = meta.get("description", "")
        if keyword_lower in description.lower():
            score += 3

        # 标签匹配
        tags = meta.get("tags", [])
        for tag in tags:
            if keyword_lower in tag.lower():
                score += 2
                break  # 只计算一次

        if score > 0:
            results.append((tool_name, meta, score))

    # 按分数排序
    results.sort(key=lambda x: x[2], reverse=True)

    print("\n" + "=" * 80)
    print(f"🔍 搜索结果: '{keyword}'")
    print("=" * 80)

    if not results:
        print(f"\n❌ 未找到匹配的工具")
        print(f"\n提示: 尝试使用其他关键词，或使用 `python3 cli.py --list` 查看所有工具")
        return

    print(f"\n找到 {len(results)} 个相关工具:")
    print("-" * 80)

    for tool_name, meta, score in results:
        print(f"\n📌 {tool_name} (相关度: {score})")
        print(f"   分类: {meta['category'] or '未分类'}")
        print(f"   描述: {meta.get('description', '无描述')}")
        print(f"   标签: {', '.join(meta.get('tags', []))}")

    print("\n" + "=" * 80)


def run_tool(tool_name: str, args: Optional[List[str]] = None) -> int:
    """
    运行指定工具

    Args:
        tool_name: 工具名称
        args: 传递给工具的参数列表

    Returns:
        int: 退出码（0=成功，非0=失败）
    """
    if tool_name not in TOOL_REGISTRY:
        print(f"\n❌ 未知的工具: {tool_name}")
        print(f"\n可用工具: {', '.join(TOOL_REGISTRY.keys())}")
        return 1

    tool_meta = TOOL_REGISTRY[tool_name]
    module_path = tool_meta["module"]
    function_name = tool_meta["function"]

    print(f"\n🚀 正在启动工具: {tool_name}")
    print(f"📁 模块: {module_path}")
    print(f"📝 描述: {tool_meta.get('description', '无描述')}")
    print("-" * 80)

    try:
        # 动态导入模块
        # 首先获取当前脚本的目录（数据管理/）
        current_dir = Path(__file__).parent

        # 构建模块路径
        module_file = current_dir / f"{module_path.replace('.', '/')}.py"

        if not module_file.exists():
            print(f"\n❌ 模块文件不存在: {module_file}")
            return 1

        # 使用 importlib 动态加载
        spec = importlib.util.spec_from_file_location(module_path, module_file)
        if spec is None or spec.loader is None:
            print(f"\n❌ 无法加载模块: {module_path}")
            return 1

        module = importlib.util.module_from_spec(spec)
        sys.modules[module_path] = module
        spec.loader.exec_module(module)

        # 获取并调用主函数
        if not hasattr(module, function_name):
            print(f"\n❌ 模块中没有找到函数: {function_name}")
            return 1

        main_func = getattr(module, function_name)

        # 调用主函数
        print(f"\n⚙️  正在执行...\n")
        main_func()

        print("\n" + "-" * 80)
        print(f"✅ 工具执行完成: {tool_name}")
        print("=" * 80 + "\n")

        return 0

    except KeyboardInterrupt:
        print(f"\n\n⚠️  用户中断执行: {tool_name}")
        return 130  # 标准的SIGINT退出码

    except Exception as e:
        print(f"\n❌ 执行工具时发生错误: {tool_name}")
        print(f"\n错误详情: {str(e)}")
        import traceback
        print("\n完整错误信息:")
        traceback.print_exc()
        return 1


def check_metadata() -> int:
    """
    检查工具元数据完整性

    Returns:
        int: 退出码（0=全部完整，非0=有缺失）
    """
    print("\n" + "=" * 80)
    print("🔍 检查工具元数据完整性...")
    print("=" * 80)

    required_fields = ["module", "function", "category", "description", "tags"]
    missing_count = 0

    for tool_name, meta in TOOL_REGISTRY.items():
        missing = []

        for field in required_fields:
            if field not in meta or not meta[field]:
                missing.append(field)

        if missing:
            print(f"\n⚠️  {tool_name}: 缺少字段 {', '.join(missing)}")
            missing_count += 1
        else:
            print(f"✅ {tool_name}: 元数据完整")

    print("-" * 80)

    if missing_count == 0:
        print("✅ 所有工具元数据检查通过")
        print("=" * 80 + "\n")
        return 0
    else:
        print(f"⚠️  发现 {missing_count} 个工具元数据不完整")
        print("=" * 80 + "\n")
        return 1


def show_info(tool_name: str) -> None:
    """
    显示工具详细信息

    Args:
        tool_name: 工具名称
    """
    if tool_name not in TOOL_REGISTRY:
        print(f"\n❌ 未知的工具: {tool_name}")
        return

    meta = TOOL_REGISTRY[tool_name]

    print("\n" + "=" * 80)
    print(f"📌 工具详情: {tool_name}")
    print("=" * 80)

    print(f"\n描述:     {meta.get('description', '无描述')}")
    print(f"分类:     {meta.get('category', '未分类')}")
    print(f"版本:     {meta.get('version', '未知')}")
    print(f"作者:     {meta.get('author', '未知')}")
    print(f"模块:     {meta['module']}")
    print(f"入口函数: {meta['function']}")
    print(f"标签:     {', '.join(meta.get('tags', []))}")

    # 尝试读取模块的docstring
    try:
        current_dir = Path(__file__).parent
        module_file = current_dir / f"{meta['module'].replace('.', '/')}.py"

        if module_file.exists():
            with open(module_file, 'r', encoding='utf-8') as f:
                content = f.read()
                # 提取docstring（简单的提取逻辑）
                if '"""' in content:
                    start = content.find('"""') + 3
                    end = content.find('"""', start)
                    if end > start:
                        docstring = content[start:end].strip()
                        print(f"\n详细说明:\n{'-' * 80}")
                        print(docstring)
    except Exception:
        pass

    print("\n" + "=" * 80)


# ============================================================================
# CLI 入口
# ============================================================================

def create_parser() -> argparse.ArgumentParser:
    """创建命令行参数解析器"""
    parser = argparse.ArgumentParser(
        prog="cli.py",
        description="数据分析工具库统一CLI入口",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python3 cli.py --list                    列出所有工具
  python3 cli.py --list data-tools         列出数据分析工具
  python3 cli.py --search parquet          搜索包含 'parquet' 的工具
  python3 cli.py --info analyze_parquet    显示工具详细信息
  python3 cli.py analyze_parquet           运行工具
  python3 cli.py --check                   检查元数据完整性

分类:
  data-tools      数据分析工具（Parquet分析、Excel分析、深度探索）
  field-tools     字段分析工具（关联分析、深度分析、穷举分析）
  conversion-tools 数据转换工具（Excel→Parquet）
  business-tools  业务计算工具（已赚保费计算）

详细文档:
  - 索引文件: 数据管理/INDEX.md
  - 快速查找: 数据管理/TOOLS.md
        """
    )

    # 互斥参数组（只能使用其中一个）
    group = parser.add_mutually_exclusive_group()

    group.add_argument(
        "-l", "--list",
        nargs="?",
        const="all",
        metavar="CATEGORY",
        help="列出所有工具，可选指定分类（如 data-tools）"
    )

    group.add_argument(
        "-s", "--search",
        metavar="KEYWORD",
        help="搜索工具（关键词匹配名称、描述、标签）"
    )

    group.add_argument(
        "-i", "--info",
        metavar="TOOL_NAME",
        help="显示工具详细信息"
    )

    group.add_argument(
        "-c", "--check",
        action="store_true",
        help="检查所有工具的元数据完整性"
    )

    # 位置参数：工具名称
    parser.add_argument(
        "tool",
        nargs="?",
        help="要运行的工具名称"
    )

    parser.add_argument(
        "--version",
        action="version",
        version="%(prog)s 1.0.0"
    )

    return parser


def main():
    """CLI 主入口"""
    parser = create_parser()

    # 如果没有参数，显示帮助信息
    if len(sys.argv) == 1:
        parser.print_help()
        list_tools()
        return 0

    args = parser.parse_args()

    # 处理各种命令
    if args.list:
        category = None if args.list == "all" else args.list
        list_tools(category)

    elif args.search:
        search_tools(args.search)

    elif args.info:
        show_info(args.info)

    elif args.check:
        return check_metadata()

    elif args.tool:
        # 运行工具
        return run_tool(args.tool)

    else:
        parser.print_help()

    return 0


if __name__ == "__main__":
    sys.exit(main())
