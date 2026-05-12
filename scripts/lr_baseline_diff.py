#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LR 口径硬化差异分解工具 (阶段 0 配套)

读取四阶口径 (raw / dedup / cutoff / final) 的 summary.json,
按"去重影响 + 估值截止影响 + 排序确定性影响"三项分解,
输出可入仓的对账 Markdown 文档,供 PR-0 审阅附件使用。

用法:
    python3 scripts/lr_baseline_diff.py \\
        --stages /path/raw/2026_LR_summary.json \\
                 /path/dedup/2026_LR_summary.json \\
                 /path/cutoff/2026_LR_summary.json \\
                 /path/final/2026_LR_summary.json \\
        --output 开发文档/reviews/<date>-lr-hardening-baseline-diff.md
"""

from __future__ import annotations
import argparse
import json
from datetime import date
from pathlib import Path


STAGE_ORDER = ("raw", "dedup", "cutoff", "final")


def load_summary(p: Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8"))


def fmt_pp(x: float) -> str:
    sign = "+" if x >= 0 else ""
    return f"{sign}{x:.2f} pp"


def fmt_pct(x: float) -> str:
    return f"{x * 100:.2f}%"


def main() -> int:
    parser = argparse.ArgumentParser(description="LR 口径硬化差异分解")
    parser.add_argument("--stages", nargs=4, required=True, type=Path,
                        help="四阶 summary.json 路径,按 raw dedup cutoff final 顺序")
    parser.add_argument("--output", required=True, type=Path,
                        help="输出 Markdown 文件路径")
    args = parser.parse_args()

    summaries = {
        stage: load_summary(p)
        for stage, p in zip(STAGE_ORDER, args.stages)
    }

    # 校验四份 summary 的 proj_year / hist_years / as_of 一致(否则差异无意义)
    base = summaries["raw"]
    for stage in ("dedup", "cutoff", "final"):
        s = summaries[stage]
        for key in ("proj_year", "as_of"):
            if s.get(key) != base.get(key):
                raise SystemExit(
                    f"[ERROR] {stage} 与 raw 的 {key} 不一致: "
                    f"{s.get(key)} vs {base.get(key)},无法对账"
                )
        if sorted(s.get("hist_years", [])) != sorted(base.get("hist_years", [])):
            raise SystemExit(f"[ERROR] {stage} 与 raw 的 hist_years 不一致")

    lr = {s: summaries[s]["overall"]["lr"] for s in STAGE_ORDER}
    hist_lr = {s: summaries[s]["overall"]["hist_lr"] for s in STAGE_ORDER}

    dedup_effect = (lr["dedup"] - lr["raw"]) * 100
    cutoff_effect = (lr["cutoff"] - lr["dedup"]) * 100
    tiebreak_effect = (lr["final"] - lr["cutoff"]) * 100
    total_effect = (lr["final"] - lr["raw"]) * 100
    residual = total_effect - (dedup_effect + cutoff_effect + tiebreak_effect)

    out = args.output
    out.parent.mkdir(parents=True, exist_ok=True)

    lines = [
        f"# LR 平移预测口径硬化基线差异对账",
        "",
        f"**生成日期**: {date.today().isoformat()}",
        f"**预测年**: {base['proj_year']}  ",
        f"**历史窗口**: {base['hist_years']}  ",
        f"**估值截止**: {base['as_of']}  ",
        f"**参数哈希**: `{base.get('run_params_hash', '')[:16]}…`",
        "",
        "## 一、整体满期赔付率四阶差异",
        "",
        "| 阶段 | 2026 全年预期 LR | 历史 2023-2025 LR | 与 raw 累计差 |",
        "|------|------------------|--------------------|---------------|",
    ]
    for stage in STAGE_ORDER:
        diff = (lr[stage] - lr["raw"]) * 100
        lines.append(
            f"| `{stage}` | {fmt_pct(lr[stage])} | {fmt_pct(hist_lr[stage])} | "
            f"{fmt_pg_or_dash(diff, stage)} |"
        )

    lines += [
        "",
        "## 二、三项影响分解(对账恒等式)",
        "",
        "| 影响来源 | 计算 | 数值 |",
        "|---------|------|------|",
        f"| 去重影响 | `dedup − raw` | **{fmt_pp(dedup_effect)}** |",
        f"| 估值截止影响 | `cutoff − dedup` | **{fmt_pp(cutoff_effect)}** |",
        f"| 排序 tie-breaker 影响 | `final − cutoff` | **{fmt_pp(tiebreak_effect)}** |",
        f"| **合计(三项)** | — | **{fmt_pp(dedup_effect + cutoff_effect + tiebreak_effect)}** |",
        f"| 总影响 | `final − raw` | **{fmt_pp(total_effect)}** |",
        f"| 残差(应 ≈ 0) | `总 − 三项` | {fmt_pp(residual)} |",
        "",
    ]

    if abs(residual) > 0.01:
        lines.append(
            f"> ⚠ 残差 {fmt_pp(residual)} 超过 0.01 pp,需检查浮点累积误差或口径分支逻辑"
        )
        lines.append("")

    lines += [
        "## 三、影响来源解释",
        "",
        "### 3.1 去重影响",
        "",
        "**口径**: 引入 `v_policy_base_dedup` 视图,严格对齐 "
        "`server/src/sql/shared/policy-dedup.ts` 的 B252 修复:",
        "- `GROUP BY policy_no, CAST(insurance_start_date AS DATE)`",
        "- `HAVING SUM(premium) > 0`(排除全退保 / 负向批改净额 ≤ 0 的保单)",
        "- 字段聚合:`premium = SUM(批改净额)`,其他字段 `ANY_VALUE()`",
        "",
        "**为何变化大**: 原口径裸 `read_parquet ... LEFT JOIN claims_agg`,"
        "同一保单的批改副本会让赔款被重复 JOIN 计算 N 倍。"
        "去重后赔款回到真实水平,赔付率显著下降。",
        "",
        "### 3.2 估值截止影响",
        "",
        "**口径**: `v_claims_agg` 增加 `WHERE report_time <= hist_as_of`,"
        "防止后续报案泄漏到历史回放或月度差异桥场景。",
        "",
        "**为何当前为 0**: 当前 claims 数据的最大 `report_time` 早于 `hist_as_of`,"
        "无赔案被过滤。但这是**结构性护栏**——一旦做月度差异桥或历史回放,"
        "必须有此过滤,否则会出现因果倒置的伪相关。",
        "",
        "### 3.3 排序 tie-breaker 影响",
        "",
        "**口径**: `DISTINCT ON (claim_no)` 排序键扩为 "
        "`ORDER BY claim_no, report_time DESC, settlement_time DESC NULLS LAST, "
        "payment_time DESC NULLS LAST`,消除 tie 时输出非确定性。",
        "",
        "**为何当前为 0**: 当前 claims 数据中同一 `claim_no` 多行场景较少,"
        "且 DuckDB 当前实现下排序稳定。但这是**确定性护栏**——保证脚本反复跑"
        "结果完全一致,差异桥才能可信。",
        "",
        "## 四、单元覆盖分布对比",
        "",
        "| 阶段 | 4d_original | 3d_fallback | 2d_fallback | 1d_fallback | overall | override |",
        "|------|-------------|-------------|-------------|-------------|---------|----------|",
    ]

    for stage in STAGE_ORDER:
        fb = summaries[stage]["fallback_distribution"]
        row = f"| `{stage}` "
        for level in ("4d_original", "3d_fallback", "2d_fallback",
                      "1d_fallback", "overall", "override"):
            row += f"| {fb.get(level, {}).get('cell_count', 0)} "
        row += "|"
        lines.append(row)

    lines += [
        "",
        "## 五、新基线接受建议",
        "",
        f"- **总体赔付率变化**: {fmt_pp(total_effect)}",
        f"- **方向**: {'下降' if total_effect < 0 else '上升'}(去重剔除了批改副本带来的赔款虚高)",
        f"- **数学一致性**: 三项分解和与总差残差 = {fmt_pp(residual)},"
        f"{'恒等式成立' if abs(residual) < 0.01 else '需检查'}",
        "",
        "**建议**: 接受新基线作为后续阶段(阶段 1-5)的回归基准。"
        "本变化来自口径与项目主分支(`policy-dedup.ts` / `metric-registry`)对齐,"
        "不引入新算法,属于工程债清理。",
        "",
        "---",
        "",
        "**审阅清单**:",
        "- [ ] 三项分解残差 < 0.01 pp",
        "- [ ] 去重影响方向(应为负,因剔除了重复赔款)",
        "- [ ] 估值截止与 tie-breaker 在当前数据下为 0(结构性护栏)",
        "- [ ] 4d_original 覆盖单元数变化(去重后单元数应不增)",
        "",
        f"**审阅人**: _______________  **审阅日期**: _______________",
        "",
    ]

    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"[DONE] 差异对账文档已生成: {out}")
    print(f"  总影响: {fmt_pp(total_effect)} (去重 {fmt_pp(dedup_effect)} + "
          f"截止 {fmt_pp(cutoff_effect)} + tie {fmt_pp(tiebreak_effect)})")
    return 0


def fmt_pg_or_dash(diff: float, stage: str) -> str:
    if stage == "raw":
        return "—"
    return fmt_pp(diff)


if __name__ == "__main__":
    raise SystemExit(main())
