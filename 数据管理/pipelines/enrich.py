#!/usr/bin/env python3
"""
续保业务类型匹配脚本

功能：从源文件读取"续保业务类型"列，按保单号匹配到目标文件中
适用于：chexianYJFX 车险盈亏分析项目的数据预处理

使用方式：
    python match_renewal_type.py --source <源文件> --target <目标文件> --output <输出文件>
    python match_renewal_type.py --config config.yaml
"""

import argparse
import logging
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

import pandas as pd
import yaml

# 项目根目录
PROJECT_ROOT = Path(__file__).parent.parent
CONFIG_DIR = PROJECT_ROOT / "config"
LOG_DIR = PROJECT_ROOT / "logs"
OUTPUT_DIR = PROJECT_ROOT / "output"
POLICY_KEY_ALIASES = ["保单号", "保单号码", "保单编号", "保单"]
RENEWAL_TYPE_ALIASES = ["续保业务类型", "续保类型", "业务类型", "续保分类"]

# 确保日志目录存在
LOG_DIR.mkdir(exist_ok=True)

# 配置日志
def setup_logging(log_file: Optional[str] = None) -> logging.Logger:
    """配置日志系统"""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = log_file or LOG_DIR / f"match_{timestamp}.log"

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(levelname)s - %(message)s",
        handlers=[
            logging.FileHandler(log_file, encoding="utf-8"),
            logging.StreamHandler()
        ]
    )
    return logging.getLogger(__name__)


def load_config(config_path: str) -> dict:
    """加载YAML配置文件"""
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def first_existing_column(columns, candidates):
    """返回第一个存在于列集合中的候选列名"""
    column_set = set(columns)
    for name in candidates:
        if name in column_set:
            return name
    return None


def normalize_policy_series(series: pd.Series) -> pd.Series:
    """标准化保单号，避免匹配失败"""
    normalized = series.astype(str).str.strip()
    normalized = normalized.replace({"": pd.NA, "nan": pd.NA, "None": pd.NA})
    normalized = normalized.str.replace(r"\.0$", "", regex=True)
    return normalized


def match_renewal_type(
    source_file: str,
    target_file: str,
    output_file: str,
    key_column: str = "保单号",
    match_column: str = "续保业务类型",
    logger: logging.Logger = None
) -> dict:
    """
    核心匹配函数：将源文件的续保业务类型匹配到目标文件

    Args:
        source_file: 源文件路径（包含续保业务类型的文件）
        target_file: 目标文件路径（需要添加续保业务类型的文件）
        output_file: 输出文件路径
        key_column: 匹配键列名（默认"保单号"）
        match_column: 要匹配的列名（默认"续保业务类型"）
        logger: 日志记录器

    Returns:
        包含处理统计信息的字典
    """
    if logger is None:
        logger = logging.getLogger(__name__)

    logger.info(f"开始处理...")
    logger.info(f"源文件: {source_file}")
    logger.info(f"目标文件: {target_file}")

    # 读取源文件
    logger.info("正在读取源文件...")
    source_header = pd.read_excel(source_file, nrows=0)
    source_key_column = key_column if key_column in source_header.columns else first_existing_column(source_header.columns, POLICY_KEY_ALIASES)
    source_match_column = match_column if match_column in source_header.columns else first_existing_column(source_header.columns, RENEWAL_TYPE_ALIASES)
    if source_key_column is None:
        raise ValueError(f"源文件缺少关键列，候选列: {POLICY_KEY_ALIASES}")
    if source_match_column is None:
        raise ValueError(f"源文件缺少匹配列，候选列: {RENEWAL_TYPE_ALIASES}")

    df_source = pd.read_excel(
        source_file,
        usecols=[source_key_column, source_match_column],
        dtype={source_key_column: str, source_match_column: str}
    )
    logger.info(f"源文件行数: {len(df_source)}, 列数: {len(df_source.columns)}")

    # 读取目标文件
    logger.info("正在读取目标文件...")
    target_header = pd.read_excel(target_file, nrows=0)
    target_key_column = key_column if key_column in target_header.columns else first_existing_column(target_header.columns, POLICY_KEY_ALIASES)
    if target_key_column is None:
        raise ValueError(f"目标文件缺少关键列，候选列: {POLICY_KEY_ALIASES}")

    df_target = pd.read_excel(target_file, dtype={target_key_column: str})
    logger.info(f"目标文件行数: {len(df_target)}, 列数: {len(df_target.columns)}")

    # 创建源文件的映射字典（保单号 -> 续保业务类型）
    logger.info("正在创建匹配映射...")
    df_source[source_key_column] = normalize_policy_series(df_source[source_key_column])
    df_source[source_match_column] = df_source[source_match_column].astype(str).str.strip()
    df_source = df_source.dropna(subset=[source_key_column]).drop_duplicates(subset=[source_key_column], keep="last")

    source_mapping = df_source.set_index(source_key_column)[source_match_column].to_dict()
    unique_source_keys = len(df_source)
    logger.info(f"源文件唯一{key_column}数: {unique_source_keys}")

    # 匹配续保业务类型到目标文件
    logger.info("正在执行匹配...")
    df_target[target_key_column] = normalize_policy_series(df_target[target_key_column])
    df_target[match_column] = df_target[target_key_column].map(source_mapping)

    # 统计匹配结果
    total_rows = len(df_target)
    matched_rows = df_target[match_column].notna().sum()
    unmatched_rows = total_rows - matched_rows
    match_rate = matched_rows / total_rows * 100 if total_rows > 0 else 0

    logger.info(f"匹配完成:")
    logger.info(f"  - 目标文件总行数: {total_rows}")
    logger.info(f"  - 成功匹配行数: {matched_rows}")
    logger.info(f"  - 未匹配行数: {unmatched_rows}")
    logger.info(f"  - 匹配率: {match_rate:.2f}%")

    # 确保输出目录存在
    output_path = Path(output_file)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # 保存结果
    logger.info(f"正在保存结果到: {output_file}")
    df_target.to_excel(output_file, index=False)
    logger.info("处理完成!")

    return {
        "source_file": str(source_file),
        "target_file": str(target_file),
        "output_file": str(output_file),
        "source_rows": len(df_source),
        "target_rows": total_rows,
        "matched_rows": int(matched_rows),
        "unmatched_rows": int(unmatched_rows),
        "match_rate": round(match_rate, 2),
        "output_columns": list(df_target.columns)
    }


def main():
    """主函数"""
    parser = argparse.ArgumentParser(
        description="续保业务类型匹配工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python match_renewal_type.py --source data/source.xlsx --target data/target.xlsx --output output/result.xlsx
  python match_renewal_type.py --config config/default.yaml
        """
    )

    parser.add_argument("--source", "-s", help="源文件路径（包含续保业务类型）")
    parser.add_argument("--target", "-t", help="目标文件路径（需要添加续保业务类型）")
    parser.add_argument("--output", "-o", help="输出文件路径")
    parser.add_argument("--config", "-c", help="配置文件路径")
    parser.add_argument("--key", "-k", default="保单号", help="匹配键列名（默认: 保单号）")
    parser.add_argument("--column", default="续保业务类型", help="要匹配的列名（默认: 续保业务类型）")

    args = parser.parse_args()

    # 设置日志
    logger = setup_logging()

    try:
        # 从配置文件或命令行参数获取设置
        if args.config:
            config = load_config(args.config)
            source_file = config.get("source_file", args.source)
            target_file = config.get("target_file", args.target)
            output_file = config.get("output_file", args.output)
            key_column = config.get("key_column", args.key)
            match_column = config.get("match_column", args.column)
        else:
            source_file = args.source
            target_file = args.target
            output_file = args.output
            key_column = args.key
            match_column = args.column

        # 验证必要参数
        if not all([source_file, target_file, output_file]):
            parser.error("需要提供 --source, --target 和 --output 参数，或使用 --config 指定配置文件")

        # 执行匹配
        result = match_renewal_type(
            source_file=source_file,
            target_file=target_file,
            output_file=output_file,
            key_column=key_column,
            match_column=match_column,
            logger=logger
        )

        logger.info(f"处理结果: {result}")
        return 0

    except Exception as e:
        logger.error(f"处理失败: {e}", exc_info=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
