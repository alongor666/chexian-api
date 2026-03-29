"""数据管道公共工具函数"""
import pandas as pd


def normalize_policy_no(series: pd.Series) -> pd.Series:
    """保单号标准化：转字符串 + 去除 .0 后缀"""
    return series.astype(str).str.replace(r'\.0$', '', regex=True)
