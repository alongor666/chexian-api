#!/usr/bin/env python3
"""
BaseConverter — ETL 脚本模板方法基类

子类只需实现 5 个 abstract methods + 可选 override 3 个 hook，即可消除 ~40%
boilerplate。基类统一负责：
  - load_excel_all_sheets 调用（governance #24 强制合规）
  - schema 缺失检测（abort）
  - CN→EN 列名重命名 + 未映射列丢弃
  - dedup + 过滤无效主键
  - write_parquet_with_metadata
  - 验证非空
  - data-sources.json 元数据回写（修复历史缺口）

抽象方法（必须实现）：
  - get_domain_id()         → str               数据域 ID
  - get_cn_to_en()          → dict[str, str]    中文→英文列名映射
  - get_required_columns()  → list[str]         必须存在的源列（中文）
  - get_str_force_cols()    → dict[str, type]   强制 str 类型的列
  - transform_rows(df)      → pd.DataFrame      类型转换 + 派生字段

可选 override：
  - get_dedup_key()         → str               去重列（默认 'policy_no'）
  - validate_business_rules(df) → pd.DataFrame  业务规则校验
  - post_write_hook(df, output_file)            写完 parquet 后钩子
"""

import argparse
import sys
from abc import ABC, abstractmethod
from pathlib import Path

import pandas as pd

_DATA_ROOT = str(Path(__file__).resolve().parent.parent)
if _DATA_ROOT not in sys.path:
    sys.path.insert(0, _DATA_ROOT)


class BaseConverter(ABC):
    """模板方法：read → schema → rename → transform → validate → dedup → write → metadata"""

    # 多省：run() 在 transform_rows 之前据 args/env 解析并赋值；无 policy_no 的 dim 子类
    # 在 transform_rows 读取以落 branch_code 常量列。类级默认 None，使直接调 transform_rows
    # 的单测无需经 run() 也有定义（回退 'SC'）。
    _declared_branch = None

    # ── 子类必须实现 ──

    @abstractmethod
    def get_domain_id(self) -> str:
        """数据域 ID，对应 data-sources.json 的 id 字段（如 'cross_sell'）"""

    @abstractmethod
    def get_cn_to_en(self) -> dict:
        """中文→英文列名映射（值集合即输出 parquet 的列集合）"""

    @abstractmethod
    def get_required_columns(self) -> list:
        """必须存在的源列名（中文）。缺失则 sys.exit(1)"""

    @abstractmethod
    def get_str_force_cols(self) -> dict:
        """强制 str 类型的列（传给 load_excel_all_sheets dtype 参数）"""

    @abstractmethod
    def transform_rows(self, df: pd.DataFrame) -> pd.DataFrame:
        """类型转换 + 派生字段。约定返回新 DataFrame（不可原地修改）"""

    # ── 可选 override ──

    def get_dedup_key(self):
        """去重列（英文名）。

        返回:
          - None: 不去重（如 dim 表 / 续保跟踪）
          - str:  单列去重
          - list[str]: 复合主键去重（如 customer_flow 的 (policy_no, insurance_start_date)）
        """
        return None

    def get_required_non_null_cols(self) -> list:
        """必须非空的列（任意 NaN 整行过滤）。dedup_key 自动加入。"""
        return []

    def validate_business_rules(self, df: pd.DataFrame) -> pd.DataFrame:
        """业务规则校验，默认 pass-through"""
        return df

    def pre_write_hook(self, df: pd.DataFrame, output_file: Path) -> None:
        """写 parquet 之前的钩子（如 customer_flow 与旧 latest.parquet 的 diff 对比）"""

    def post_write_hook(self, df: pd.DataFrame, output_file: Path) -> None:
        """写完 parquet 后的钩子（如 diff 报告 / 额外统计）"""

    def get_title(self) -> str:
        """打印用的友好标题。默认基于 domain_id"""
        return f"{self.get_domain_id()} → Parquet"

    # ── 共享流程 ──

    def run(self) -> None:
        from pipelines.etl_validation import (
            validate_input_path,
            validate_output_path,
            verify_non_empty,
            load_excel_all_sheets,
        )
        from pipelines.parquet_utils import write_parquet_with_metadata
        from pipelines.data_sources_updater import update_data_sources

        args = self._parse_args()
        input_file = validate_input_path(str(args.input))
        output_file = validate_output_path(str(args.output))

        # 多省：在 transform_rows 之前解析 declared_branch 并存到实例，供 dim 表
        # （repair/brand 等无 policy_no、不走下方 6c registry 派生入口的域）在自身
        # transform_rows 直接落 branch_code 常量列时读取。SC 默认链路（无 --branch-code
        # 且无 BRANCH_CODE env）解析为 None → 子类回退 'SC'，四川产物逐字节等价。
        from pipelines.derived_fields import resolve_declared_branch
        self._declared_branch = resolve_declared_branch(args)

        cn_to_en = self.get_cn_to_en()
        required = self.get_required_columns()
        key = self.get_dedup_key()

        print("=" * 80)
        print(f"📋 {self.get_title()}")
        print("=" * 80)
        print(f"   输入: {Path(args.input).name}")

        # 1. 加载（governance #24：必须用 load_excel_all_sheets）
        df = load_excel_all_sheets(
            input_file,
            dtype=self.get_str_force_cols(),
            required_columns=required,
        )
        df = df.copy()
        df.columns = df.columns.str.strip()

        # 2. Schema 契约（缺列 abort）
        missing = [c for c in required if c not in df.columns]
        if missing:
            print(f"   ❌ 缺少必须列: {missing}")
            print(f"      实际列: {list(df.columns)}")
            sys.exit(1)

        # 3. 列名重命名（丢弃未映射列）
        rename_map = {k: v for k, v in cn_to_en.items() if k in df.columns}
        df = df.rename(columns=rename_map)
        extra = [c for c in df.columns if c not in cn_to_en.values()]
        if extra:
            print(f"   ⚠ 未映射列（已丢弃）: {extra}")
            df = df[[c for c in df.columns if c in cn_to_en.values()]]
        print(f"   列名重命名: {len(rename_map)}/{len(cn_to_en)} 列")

        # 4. 子类类型转换 + 派生字段
        df = self.transform_rows(df)

        # 5. 业务规则校验
        df = self.validate_business_rules(df)

        # 6a. 去重（仅 dedup_key 非 None；支持单列或复合主键）
        if key:
            key_cols = [key] if isinstance(key, str) else list(key)
            missing_keys = [c for c in key_cols if c not in df.columns]
            if missing_keys:
                print(f"   ⚠ 去重列缺失，跳过去重: {missing_keys}")
            else:
                before = len(df)
                df = df.drop_duplicates(subset=key_cols, keep="first")
                if len(df) < before:
                    label = key if isinstance(key, str) else "+".join(key_cols)
                    print(f"   去重: {before - len(df):,} 行（按 {label}）")

        # 6b. 必须非空列过滤（dedup_key 自动加入）
        non_null_cols = list(self.get_required_non_null_cols())
        if key:
            for k in ([key] if isinstance(key, str) else key):
                if k not in non_null_cols:
                    non_null_cols.append(k)
        for col in non_null_cols:
            if col in df.columns:
                before = len(df)
                df = df[df[col].notna()].copy()
                if len(df) < before:
                    print(f"   过滤无 {col}: {before - len(df):,} 行")

        # 6c-多省 P3-B：branch_code 从 policy_no 前 3 位 prefix_map 派生（与 P1 premium #762 /
        #   P3-A claims_detail #763 同语义；唯一事实源 = fields.json branch_code derivation）
        #   · 'policy_no' in df.columns（cross_sell / customer_flow）→ apply_registry_derivations
        #     派生 + assertDeclaredBranch / strictNonNull fail-fast（防混省 / 喂错省 / NULL 省码）；
        #     declared_branch 缺省回退 'SC'（codex 闸-1 P1-1：SC 默认链路也需 assertDeclaredBranch
        #     守卫，否则混省行不会 fail-fast）
        #   · 'policy_no' not in df.columns（dim 表 repair / brand）→ 安静跳过派生入口，避免
        #     derived_fields.py 内 strict 守卫对 dim 表误触 fail-fast
        from pipelines.derived_fields import apply_registry_derivations
        declared_branch = self._declared_branch
        if 'policy_no' in df.columns:
            df = apply_registry_derivations(df, declared_branch or 'SC')
        elif declared_branch:
            print(
                f"   ℹ 跳过 branch_code 派生（{self.get_domain_id()} 无 policy_no 列；"
                f"declared={declared_branch}）"
            )

        # 6d. pre-write 钩子（如 customer_flow 与旧 parquet 做 diff 对比）
        self.pre_write_hook(df, output_file)

        # 7. 写 Parquet
        write_parquet_with_metadata(
            df,
            output_file,
            source_file=str(args.input),
            processing_mode=f"convert_{self.get_domain_id()}",
        )
        size_mb = output_file.stat().st_size / 1024 / 1024
        print(f"\n   输出: {output_file} ({size_mb:.1f} MB)")

        # 8. 验证
        verify = pd.read_parquet(output_file)
        verify_non_empty(verify)
        print(f"   验证: {len(verify):,} 行 × {len(verify.columns)} 列 ✅")

        # 9. 元数据回写（基类统一执行，修复历史缺口）
        # manifest 驱动流程传入 --no-metadata，跳过此处写入；
        # 由 refresh_metadata.py 在所有域完成后统一单点写入，消除 #4 双写漂移。
        # 多省 0a：非 SC 省（--branch-code）同样跳过，避免把隔离省行数写进共享
        # data-sources.json（SC 唯一事实源；ADR D5）。
        if not args.no_metadata and not args.branch_code:
            update_data_sources(
                self.get_domain_id(),
                row_count=len(df),
                field_count=len(df.columns),
            )

        # 10. post-write 钩子（如 customer_flow 的 diff 报告）
        self.post_write_hook(df, output_file)

        print("=" * 80)
        print("✅ 完成")

    def _parse_args(self) -> argparse.Namespace:
        parser = argparse.ArgumentParser(description=self.get_title())
        parser.add_argument("-i", "--input", required=True, help="输入 Excel 文件")
        parser.add_argument("-o", "--output", required=True, help="输出 Parquet 文件")
        parser.add_argument(
            "--no-metadata",
            action="store_true",
            help="跳过 data-sources.json 写入（manifest 驱动流程专用，由 refresh_metadata.py 统一写）",
        )
        parser.add_argument(
            "--branch-code",
            default=None,
            help="多省 P3-B（ADR D5；2026-06-23 起 constant 注入升级为 prefix_map 派生）："
                 "分公司编码（如 SX）。提供时透传 declared_branch 给 derived_fields 做 "
                 "assertDeclaredBranch 校对「声明省==派生省」+ 跳过 data-sources.json 写入；"
                 "SC 默认链路不传 → declared_branch 回退 'SC'（让 assertDeclaredBranch 仍守卫"
                 "混省）；branch_code 列恒从 fields.json prefix_map(policy_no, len=3) 派生。",
        )
        return parser.parse_args()
