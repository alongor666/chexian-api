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


OUTPUT_COLUMNS = [
    "policy_no",
    "insurance_start_date",
    "vehicle_frame_no",
    "previous_insurer",
    "next_insurer",
]


def infer_snapshot_part_name(input_file: Path) -> str | None:
    if "_08_" in input_file.name:
        return "08_loss.parquet"
    if "_09_" in input_file.name:
        return "09_previous.parquet"
    return None


def build_customer_flow_dataframe(
    input_files: list[Path],
    snapshot_dir: Path | None = None,
    batch_date: str | None = None,
    declared_branch: str | None = None,
) -> pd.DataFrame:
    """读取新的 08/09 双产物，并合成为原 customer_flow schema。

    declared_branch: 多省 P3-B（codex 闸-1 P1-1/P1-4）。
        · 'SC' / 'SX' / None：派生 branch_code 时透传给 derived_fields.assert_guarded_prefix_field
          做「声明省 == 派生省」核对。
        · None 会在最终 final snapshot 派生时回退 'SC'，使 SC 默认链路也能被
          assertDeclaredBranch 守卫到（防混省）。
        · 08/09 part snapshot 保持原 5 列源 schema（不派生 branch_code），因为分片快照只反映源
          Excel 内容；final snapshot 与主产物保持 6 列一致（含派生的 branch_code）。
    """
    from pipelines.etl_validation import load_excel_all_sheets

    converter = CustomerFlowConverter()
    frames = []
    required = converter.get_required_columns()
    cn_to_en = converter.get_cn_to_en()

    for input_file in input_files:
        df = load_excel_all_sheets(
            input_file,
            dtype=converter.get_str_force_cols(),
            required_columns=required,
        ).copy()
        df.columns = df.columns.str.strip()
        missing = [c for c in required if c not in df.columns]
        if missing:
            raise ValueError(f"{input_file.name} 缺少必须列: {missing}; 实际列: {list(df.columns)}")

        rename_map = {k: v for k, v in cn_to_en.items() if k in df.columns}
        df = df.rename(columns=rename_map)
        keep = [c for c in df.columns if c in OUTPUT_COLUMNS]
        df = df[keep]
        for col in OUTPUT_COLUMNS:
            if col not in df.columns:
                df[col] = pd.NA
        df = converter.transform_rows(df[OUTPUT_COLUMNS])
        if snapshot_dir:
            part_name = infer_snapshot_part_name(input_file)
            if part_name:
                from pipelines.parquet_utils import write_parquet_with_metadata

                snapshot_dir.mkdir(parents=True, exist_ok=True)
                write_parquet_with_metadata(
                    df[OUTPUT_COLUMNS],
                    snapshot_dir / part_name,
                    source_file=str(input_file),
                    processing_mode=f"convert_customer_flow_{part_name.replace('.parquet', '')}",
                    extra_metadata={"source_batch_date": batch_date or ""},
                )
        frames.append(df)
        print(f"   产物: {input_file.name} → {len(df):,} 行 × {len(df.columns)} 列")

    if not frames:
        raise ValueError("未提供 customer_flow 输入文件")

    df = pd.concat(frames, ignore_index=True)
    before_filter = len(df)
    df = df[df["policy_no"].notna() & df["insurance_start_date"].notna()].copy()
    if len(df) < before_filter:
        print(f"   过滤无 policy_no/insurance_start_date: {before_filter - len(df):,} 行")

    before = len(df)
    df = (
        df.groupby(["policy_no", "insurance_start_date"], as_index=False, sort=False)
        .first()
    )
    if len(df) < before:
        print(f"   合并 08/09 重叠主键: {before - len(df):,} 行")

    final = df[OUTPUT_COLUMNS].sort_values(["insurance_start_date", "policy_no"]).reset_index(drop=True)

    # 多省 P3-B（codex 闸-1 P1-4）：在 final snapshot 写出**之前**派生 branch_code，使 final
    #   snapshot 与主产物 schema 一致（6 列含 branch_code）。08/09 part snapshot 保持源 5 列。
    from pipelines.derived_fields import apply_registry_derivations
    final = apply_registry_derivations(final, declared_branch or 'SC')

    if snapshot_dir:
        from pipelines.parquet_utils import write_parquet_with_metadata

        snapshot_dir.mkdir(parents=True, exist_ok=True)
        write_parquet_with_metadata(
            final,
            snapshot_dir / "customer_flow.parquet",
            source_file=", ".join(str(p) for p in input_files),
            processing_mode="convert_customer_flow_snapshot",
            extra_metadata={"source_batch_date": batch_date or ""},
        )
    return final


class CustomerFlowConverter(BaseConverter):
    def get_domain_id(self) -> str:
        return "customer_flow"

    def get_title(self) -> str:
        return "08/09 客户流向双产物 → Parquet"

    def get_cn_to_en(self) -> dict:
        return {
            "保单号": "policy_no",
            "保险起期": "insurance_start_date",
            "车架号": "vehicle_frame_no",
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
        for col in ("policy_no", "vehicle_frame_no", "previous_insurer",
                    "next_insurer"):
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

    def run(self) -> None:
        import argparse

        from pipelines.data_sources_updater import update_data_sources
        from pipelines.etl_validation import (
            validate_input_path,
            validate_output_path,
            verify_non_empty,
        )
        from pipelines.parquet_utils import write_parquet_with_metadata

        parser = argparse.ArgumentParser(description=self.get_title())
        parser.add_argument("-i", "--input", nargs="+", required=True, help="输入 Excel 文件（08/09 双产物）")
        parser.add_argument("-o", "--output", required=True, help="输出 Parquet 文件")
        parser.add_argument(
            "--no-metadata",
            action="store_true",
            help="跳过 data-sources.json 写入（manifest 驱动流程专用，由 refresh_metadata.py 统一写）",
        )
        parser.add_argument(
            "--branch-code",
            default=None,
            help="多省 P3-B（ADR D5）：分公司编码（如 SX）。提供时透传 declared_branch 给"
                 " derived_fields.assertDeclaredBranch 校对「声明省==派生省」+ 跳过 data-sources.json"
                 " 写入；SC 默认链路不传 → declared_branch 回退 'SC'（让 assertDeclaredBranch 仍守卫"
                 " 混省）；branch_code 列**始终**派生（与 base_converter.py:177 同语义，"
                 " cross_sell/customer_flow 主产物 schema 一致）。",
        )
        parser.add_argument("--snapshot-dir", default=None, help="可选：写出 08/09 中间快照和 final snapshot 的目录")
        parser.add_argument("--batch-date", default=None, help="可选：快照批次日期 YYYYMMDD")
        args = parser.parse_args()

        input_files = [validate_input_path(str(p)) for p in args.input]
        output_file = validate_output_path(str(args.output))

        print("=" * 80)
        print(f"📋 {self.get_title()}")
        print("=" * 80)
        for input_file in input_files:
            print(f"   输入: {input_file.name}")

        # 多省 P3-B：声明省解析（CLI > env > None；归一大写）；下游派生若 None 回退 'SC'
        from pipelines.derived_fields import resolve_declared_branch
        declared_branch = resolve_declared_branch(args)

        snapshot_dir = Path(args.snapshot_dir).resolve() if args.snapshot_dir else None
        df = build_customer_flow_dataframe(
            input_files,
            snapshot_dir=snapshot_dir,
            batch_date=args.batch_date,
            declared_branch=declared_branch,
        )
        self.pre_write_hook(df, output_file)

        source_names = ", ".join(str(p) for p in input_files)
        write_parquet_with_metadata(
            df,
            output_file,
            source_file=source_names,
            processing_mode=f"convert_{self.get_domain_id()}",
        )
        size_mb = output_file.stat().st_size / 1024 / 1024
        print(f"\n   输出: {output_file} ({size_mb:.1f} MB)")

        verify = pd.read_parquet(output_file)
        verify_non_empty(verify)
        print(f"   验证: {len(verify):,} 行 × {len(verify.columns)} 列 ✅")

        # 多省 P3-B：非 SC 省（--branch-code）跳过 data-sources.json，避免污染 SC 唯一事实源
        #   （与 base_converter.py:206 同语义；ADR D5）
        if not args.no_metadata and not args.branch_code:
            update_data_sources(
                self.get_domain_id(),
                row_count=len(df),
                field_count=len(df.columns),
            )

        self.post_write_hook(df, output_file)

        print("=" * 80)
        print("✅ 完成")

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
            (
                (merged["next_old"].notna())
                & (merged["next_insurer"].notna())
                & (merged["next_old"] != merged["next_insurer"])
            ).sum()
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
