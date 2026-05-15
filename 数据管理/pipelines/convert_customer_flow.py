#!/usr/bin/env python3
"""
客户来源去向 Excel → customer_flow/latest.parquet

客户转保/流失分析数据：上年承保主体 → 华安 → 次年保险公司。

用法：
  python3 convert_customer_flow.py -i 08_客户来源去向.xlsx -o warehouse/fact/customer_flow/latest.parquet
"""

import sys
import unicodedata
from pathlib import Path

import pandas as pd

_DATA_ROOT = str(Path(__file__).resolve().parent.parent)
if _DATA_ROOT not in sys.path:
    sys.path.insert(0, _DATA_ROOT)

from pipelines.base_converter import BaseConverter
from pipelines.etl_validation import PLACEHOLDER_STRS, safe_pct


class CustomerFlowConverter(BaseConverter):
    def get_domain_id(self) -> str:
        return "customer_flow"

    def get_title(self) -> str:
        return "客户来源去向 → Parquet"

    def get_cn_to_en(self) -> dict:
        return {
            "保单号": "policy_no",
            "保险起期": "insurance_start_date",
            "车架号": "vehicle_frame_no",
            "整备质量": "curb_weight",
            "续航里程分组": "range_group",
            "上年承保主体": "previous_insurer",
            "次年保险公司": "next_insurer",
        }

    def get_required_columns(self) -> list:
        return ["保单号"]

    def get_str_force_cols(self) -> dict:
        return {"保单号": str, "车架号": str}

    def get_dedup_key(self):
        # 复合主键: 源 Excel 单文件内 policy_no 重复率 8~15%（同保单不同起期），
        # 加上 insurance_start_date 后唯一。详见 docs/data-sources/customer_flow.md
        return ["policy_no", "insurance_start_date"]

    def transform_rows(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        if "insurance_start_date" in df.columns:
            df["insurance_start_date"] = pd.to_datetime(
                df["insurance_start_date"], errors="coerce"
            )
            valid = int(df["insurance_start_date"].notna().sum())
            print(
                f"   保险起期: {df['insurance_start_date'].min()} ~"
                f" {df['insurance_start_date'].max()} ({valid:,} 有值)"
            )
        if "curb_weight" in df.columns:
            df["curb_weight"] = pd.to_numeric(df["curb_weight"], errors="coerce")
        for col in ("policy_no", "vehicle_frame_no", "previous_insurer",
                    "next_insurer", "range_group"):
            if col in df.columns:
                df[col] = df[col].astype(str).str.strip().replace(PLACEHOLDER_STRS, None)
        return df

    def pre_write_hook(self, df: pd.DataFrame, output_file: Path) -> None:
        # 数据概览（保持原代码打印顺序：概览 → diff → write）
        print("\n   === 数据概览 ===")
        print(f"   记录数: {len(df):,}")
        print(f"   唯一保单: {df['policy_no'].nunique():,}")
        # 复合主键去重核查（治理 #1：源 Excel policy_no 在同文件内会重复 8~15%，
        # 加 insurance_start_date 后必须唯一）
        if {"policy_no", "insurance_start_date"}.issubset(df.columns):
            composite_dup = int(
                df.duplicated(subset=["policy_no", "insurance_start_date"]).sum()
            )
            if composite_dup > 0:
                print(f"   ⚠ 复合主键残留重复: {composite_dup:,} 行 (policy_no + start_date)")
                print(f"      预期 0；如出现请排查 BaseConverter 去重逻辑")
            else:
                print(f"   ✓ 复合主键唯一性: 通过 (policy_no + start_date)")
        if "previous_insurer" in df.columns:
            n = int(df["previous_insurer"].notna().sum())
            print(f"   有上年承保主体: {n:,} ({safe_pct(n, len(df)):.1f}%)")
            print(f"   上年承保主体TOP10: {df['previous_insurer'].value_counts().head(10).to_dict()}")
        if "next_insurer" in df.columns:
            n = int(df["next_insurer"].notna().sum())
            print(f"   有次年保险公司: {n:,} ({safe_pct(n, len(df)):.1f}%)")
            print(f"   次年保险公司TOP10: {df['next_insurer'].value_counts().head(10).to_dict()}")
            # 治理 #1 观测：next_insurer 当前是「单次写入式」，填充率应只升不降
            self._print_next_insurer_drift(df, output_file)
        # 日期连续性观测（治理 #1）
        if "insurance_start_date" in df.columns:
            self._print_date_continuity(df)
        # 与旧 latest.parquet 做 diff（写新 parquet 之前对比）
        self._print_diff_report(df, output_file)

    @staticmethod
    def _print_date_continuity(df: pd.DataFrame) -> None:
        """检查 insurance_start_date 在 2025-01-01 ~ max(start_date) 区间是否连续

        仅在合并后的大文件上有意义；单文件（< 100k 行）跳过以避免误报。
        """
        if len(df) < 100_000:
            return  # 单文件转换阶段跳过，仅在最终合并/历史底库上检查
        from datetime import timedelta
        d = pd.to_datetime(df["insurance_start_date"], errors="coerce").dropna()
        if d.empty:
            return
        start = pd.Timestamp("2025-01-01")
        end = d.max().normalize()
        if end < start:
            return
        present = set(d.dt.normalize().unique())
        expected_days = (end - start).days + 1
        missing = []
        cur = start
        while cur <= end:
            if cur not in present:
                missing.append(cur.strftime("%Y-%m-%d"))
            cur += timedelta(days=1)
        present_days = expected_days - len(missing)
        print(f"   日期覆盖 (2025-01-01~{end.date()}): {present_days}/{expected_days} 天，"
              f"缺失 {len(missing)} 天")
        if missing:
            preview = ", ".join(missing[:5])
            more = f" ... +{len(missing) - 5} 天" if len(missing) > 5 else ""
            print(f"   ⚠ 缺失日期: {preview}{more}")

    @staticmethod
    def _print_next_insurer_drift(df_new: pd.DataFrame, output_file: Path) -> None:
        """对照旧 parquet 检查 next_insurer 漂移：

        - 空 → 非空：业务侧补录（治理目标，看到就好）
        - 非空 → 空：异常（不应发生，告警）
        - 值变更：异常（业务侧改正，少见）
        """
        old_path = output_file.parent / "latest.parquet"
        if output_file.name == "latest.parquet":
            old_path = output_file
        if not old_path.exists():
            return
        try:
            df_old = pd.read_parquet(
                old_path,
                columns=["policy_no", "insurance_start_date", "next_insurer"],
            )
        except Exception:
            return
        join_cols = ["policy_no", "insurance_start_date"]
        merged = df_new[join_cols + ["next_insurer"]].merge(
            df_old[join_cols + ["next_insurer"]].rename(columns={"next_insurer": "next_old"}),
            on=join_cols,
            how="inner",
            validate="one_to_one",
        )
        void_to_value = int(((merged["next_old"].isna()) & (merged["next_insurer"].notna())).sum())
        value_to_void = int(((merged["next_old"].notna()) & (merged["next_insurer"].isna())).sum())
        value_change = int(
            (merged["next_old"].notna())
            & (merged["next_insurer"].notna())
            & (merged["next_old"] != merged["next_insurer"])
        )
        print(f"   next_insurer 漂移对照旧 parquet:")
        print(f"     空→非空（补录）: {void_to_value:,}  ← 治理目标值，越多越好")
        if value_to_void > 0:
            print(f"     ⚠ 非空→空      : {value_to_void:,}  ← 异常，请排查源数据")
        if value_change > 0:
            print(f"     值变更（改正） : {value_change:,}")

    @staticmethod
    def _print_diff_report(df_new: pd.DataFrame, output_file: Path) -> None:
        """与旧 parquet 对比，输出 diff 摘要。全量替换不变，仅增加可见性。"""
        # 旧文件路径：output_file 可能带 .tmp 后缀（safeConvertDomain），取同目录 latest.parquet
        old_path = output_file.parent / "latest.parquet"
        if output_file.name == "latest.parquet":
            old_path = output_file
        if not old_path.exists():
            print("\n   ℹ 首次写入，无旧数据可对比")
            return

        try:
            df_old = pd.read_parquet(
                old_path, columns=["policy_no", "previous_insurer", "next_insurer"]
            )
        except Exception as e:
            print(f"\n   ⚠ 读取旧 parquet 失败，跳过 diff: {e}")
            return

        old_set = set(df_old["policy_no"].dropna())
        new_set = set(df_new["policy_no"].dropna())
        added_keys = new_set - old_set
        removed_keys = old_set - new_set
        common_keys = old_set & new_set

        # 状态变更：上年承保主体或次年保险公司发生变化
        changed_count = 0
        flow_changes = []
        if common_keys:
            old_lookup = df_old.set_index("policy_no")[["previous_insurer", "next_insurer"]]
            new_lookup = df_new.set_index("policy_no")[["previous_insurer", "next_insurer"]]
            common_old = old_lookup.loc[old_lookup.index.isin(common_keys)]
            common_new = new_lookup.loc[new_lookup.index.isin(common_keys)]
            common_old, common_new = common_old.align(common_new, join="inner")
            mask = (common_old.fillna("") != common_new.fillna("")).any(axis=1)
            changed_count = mask.sum()
            if changed_count > 0:
                changed_old = common_old[mask]
                changed_new = common_new[mask]
                next_old = changed_old["next_insurer"].fillna("（无）")
                next_new = changed_new["next_insurer"].fillna("（无）")
                flow_pairs = pd.DataFrame({"from": next_old, "to": next_new})
                flow_pairs = flow_pairs[flow_pairs["from"] != flow_pairs["to"]]
                if not flow_pairs.empty:
                    flow_pairs["from"] = flow_pairs["from"].str[:4]
                    flow_pairs["to"] = flow_pairs["to"].str[:4]
                    top_flows = flow_pairs.groupby(["from", "to"]).size().nlargest(5)
                    flow_changes = [(f"{f} → {t}", c) for (f, t), c in top_flows.items()]

        # 新增保单的保险起期分布
        added_date_range = ""
        if added_keys and "insurance_start_date" in df_new.columns:
            added_df = df_new[df_new["policy_no"].isin(added_keys)]
            dates = added_df["insurance_start_date"].dropna()
            if not dates.empty:
                added_date_range = (
                    f"{dates.min().strftime('%Y-%m-%d')} ~ {dates.max().strftime('%Y-%m-%d')}"
                )

        def _display_width(s: str) -> int:
            return sum(2 if unicodedata.east_asian_width(c) in ("W", "F") else 1 for c in s)

        def _pad_right(s: str, width: int) -> str:
            return s + " " * (width - _display_width(s))

        net = len(df_new) - len(df_old)
        net_str = f"+{net:,}" if net >= 0 else f"{net:,}"

        print(f"\n{'='*80}")
        print("   Diff 报告")
        print("=" * 80)
        print(f"   旧数据: {len(df_old):>10,} 条")
        print(f"   新数据: {len(df_new):>10,} 条")
        print(f"   净增:   {net_str:>10}")
        print()
        print(f"   {_pad_right('变更类型', 12)} {'条数':>8}  说明")
        print(f"   {'-'*12} {'-'*8}  {'-'*30}")
        rows = [
            ("新增保单", len(added_keys), "新签保单首次进入流转"),
            ("状态变更", changed_count, "上年承保主体或次年保险公司有变化"),
            ("消失保单", len(removed_keys), "旧数据有、新数据无"),
        ]
        for label, count, desc in rows:
            print(f"   {_pad_right(label, 12)} {count:>8,}  {desc}")
        if flow_changes:
            print("\n   流向变更 TOP 5:")
            for label, count in flow_changes:
                print(f"     {_pad_right(label, 20)} {count:>6,} 单")
        if added_date_range:
            print(f"\n   新增保单保险起期: {added_date_range}")
        print("=" * 80)


if __name__ == "__main__":
    CustomerFlowConverter().run()
