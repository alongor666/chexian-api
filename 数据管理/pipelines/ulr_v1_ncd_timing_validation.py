#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ULR v1 · NCD 时点验证脚本（T3 交付物）

验证 `no_claim_bonus`（商业险NCD文本）是否基于 **上一保单期** 的出险历史生成。
这是 Prior 模型使用该字段的前置条件：若无法证明 NCD 档位在本期起保时点前已确定，
则必须从 Prior 降级为 overlay 或监控。

方法：
  1. 从 2021-2024 续保单（is_renewal=true）随机抽取 1000 张
  2. 通过 vehicle_frame_no 关联上一期保单（起期差 180-540 天）
  3. 按上期出险状态分组（有案 vs 无案）
  4. 比对本期 no_claim_bonus 档位是否符合预期

输出：
  数据管理/数据分析报告/ulr_v1_ncd_timing_{valuation_date}.md / .json

判定阈值：
  ≥95% 样本档位与上期出险状态一致 → PASS，NCD 可进入 Prior
  80-94% → CONDITIONAL，作为 overlay 特征使用
  <80% → FAIL，从 Prior 排除
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from pathlib import Path

import duckdb

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
POLICY_GLOB = str(REPO_ROOT / "数据管理/warehouse/fact/policy/current/*.parquet")
CLAIMS_PATH = str(REPO_ROOT / "数据管理/warehouse/fact/claims_detail/claims_*.parquet")
REPORT_DIR = REPO_ROOT / "数据管理/数据分析报告"


# ============================================================================
# 1. NCD 档位解析
# ============================================================================

def classify_ncd_tier(text: str | None) -> str:
    """将 no_claim_bonus 文本映射到标准档位。

    实际数据格式（样本已确认）：
      "首年投保或未发生浮动"                          → LEVEL
      "连续N年投保且没有发生赔付"                     → UP
      "连续N年投保且发生X次赔付"                      → DOWN_1/2/3+
      "连续0年投保且有发生赔付"                       → DOWN_1（边界情况）

    档位定义：
      UP      - 下浮（上年无赔款，享折扣）
      LEVEL   - 平档（首次投保或基准）
      DOWN_1  - 小幅上浮（上年 1 次赔款）
      DOWN_2  - 中幅上浮（上年 2 次赔款）
      DOWN_3+ - 大幅上浮（上年 3+ 次赔款）
      UNKNOWN - 无法识别
    """
    if text is None:
        return "UNKNOWN"
    t = str(text).strip()
    if not t:
        return "UNKNOWN"

    if "首年" in t or "未发生浮动" in t or "首次" in t or "新保" in t:
        return "LEVEL"

    if "没有发生赔付" in t or "无赔款" in t or "无出险" in t or "未出险" in t:
        return "UP"

    # "连续N年投保且发生X次赔付" / "连续0年投保且有发生赔付"
    m = re.search(r"发生\s*(\d+)\s*次\s*赔付", t)
    if m:
        n = int(m.group(1))
        if n == 0:
            return "UP"
        if n == 1:
            return "DOWN_1"
        if n == 2:
            return "DOWN_2"
        return "DOWN_3+"

    if "有发生赔付" in t or "发生赔付" in t:
        return "DOWN_1"

    if "上浮" in t or "涨幅" in t:
        return "DOWN_1"

    return "UNKNOWN"


def expected_tier_by_prior_claims(prior_claim_count: int) -> str:
    """上期出险次数 → 预期本期 NCD 档位。"""
    if prior_claim_count == 0:
        return "UP"
    if prior_claim_count == 1:
        return "DOWN_1"
    if prior_claim_count == 2:
        return "DOWN_2"
    return "DOWN_3+"


def tier_is_consistent(actual: str, expected: str) -> bool:
    """判断实际档位与预期是否一致。

    宽松匹配：
      - 首次/LEVEL 视为 UP 的合理变体（宽限新保数据）
      - DOWN_3+ 与 DOWN_2 视为方向一致
    """
    if actual == "UNKNOWN":
        return False
    if actual == expected:
        return True
    # 方向一致的宽松匹配
    directions = {
        "UP": "up",
        "LEVEL": "up",
        "DOWN_1": "down",
        "DOWN_2": "down",
        "DOWN_3+": "down",
    }
    return directions.get(actual) == directions.get(expected)


# ============================================================================
# 2. 抽样与关联
# ============================================================================

def sample_renewal_pairs(con: duckdb.DuckDBPyConnection, sample_size: int = 1000,
                        seed: int = 42,
                        policy_glob: str = POLICY_GLOB,
                        claims_path: str = CLAIMS_PATH) -> list[dict]:
    """抽样续保对（本期 + 上期）并统计上期出险。

    Returns:
        [{current_policy_no, current_start, current_ncd_text, vin,
          prior_policy_no, prior_start, prior_claim_count}, ...]
    """
    sql = f"""
    WITH origin AS (
        SELECT
            policy_no,
            vehicle_frame_no,
            insurance_start_date,
            no_claim_bonus,
            is_renewal,
            premium
        FROM read_parquet('{policy_glob}', union_by_name := true)
        WHERE endorsement_no IS NULL
          AND premium > 0
          AND vehicle_frame_no IS NOT NULL
          AND LENGTH(TRIM(vehicle_frame_no)) >= 10
          AND YEAR(insurance_start_date) BETWEEN 2021 AND 2024
    ),
    renewal_current AS (
        SELECT * FROM origin
        WHERE is_renewal = TRUE
          AND no_claim_bonus IS NOT NULL
    ),
    -- 关联上一期：同 VIN，起期差 180-540 天（容忍提前/延后续保）
    paired AS (
        SELECT
            c.policy_no         AS current_policy_no,
            c.insurance_start_date AS current_start,
            c.no_claim_bonus    AS current_ncd_text,
            c.vehicle_frame_no  AS vin,
            p.policy_no         AS prior_policy_no,
            p.insurance_start_date AS prior_start,
            DATE_DIFF('day', p.insurance_start_date, c.insurance_start_date)
                AS gap_days,
            ROW_NUMBER() OVER (
                PARTITION BY c.policy_no
                ORDER BY ABS(DATE_DIFF('day', p.insurance_start_date,
                                       c.insurance_start_date - INTERVAL 1 YEAR))
            ) AS rn
        FROM renewal_current c
        JOIN origin p
          ON p.vehicle_frame_no = c.vehicle_frame_no
         AND p.policy_no != c.policy_no
         AND p.insurance_start_date < c.insurance_start_date
         AND DATE_DIFF('day', p.insurance_start_date, c.insurance_start_date)
             BETWEEN 180 AND 540
    ),
    sampled AS (
        SELECT * FROM paired WHERE rn = 1
        USING SAMPLE {sample_size} ROWS (RESERVOIR, {seed})
    ),
    -- 统计上期保单的出险次数（以赔案 accident_time 落在上期保单责任期内为准）
    prior_claims AS (
        SELECT
            s.current_policy_no,
            COUNT(DISTINCT c.claim_no) AS prior_claim_count
        FROM sampled s
        LEFT JOIN read_parquet('{claims_path}') c
          ON c.policy_no = s.prior_policy_no
         AND c.accident_time IS NOT NULL
         AND c.accident_time >= s.prior_start
         AND c.accident_time < s.prior_start + INTERVAL 1 YEAR
        GROUP BY s.current_policy_no
    )
    SELECT
        s.current_policy_no,
        s.current_start,
        s.current_ncd_text,
        s.vin,
        s.prior_policy_no,
        s.prior_start,
        s.gap_days,
        COALESCE(pc.prior_claim_count, 0) AS prior_claim_count
    FROM sampled s
    LEFT JOIN prior_claims pc USING (current_policy_no)
    """
    rows = con.sql(sql).fetchall()
    cols = [
        "current_policy_no", "current_start", "current_ncd_text", "vin",
        "prior_policy_no", "prior_start", "gap_days", "prior_claim_count",
    ]
    return [dict(zip(cols, r)) for r in rows]


# ============================================================================
# 3. 分析与报告
# ============================================================================

def analyze(pairs: list[dict]) -> dict:
    """分析抽样结果，输出一致率与分档统计。"""
    total = len(pairs)
    if total == 0:
        return {"total": 0, "error": "抽样为空，请检查数据"}

    buckets: dict[str, dict] = {}
    consistent_count = 0
    unknown_count = 0

    for p in pairs:
        actual_tier = classify_ncd_tier(p["current_ncd_text"])
        expected_tier = expected_tier_by_prior_claims(p["prior_claim_count"])
        is_consistent = tier_is_consistent(actual_tier, expected_tier)

        if actual_tier == "UNKNOWN":
            unknown_count += 1
        elif is_consistent:
            consistent_count += 1

        key = f"prior_{min(p['prior_claim_count'], 3)}_claim"
        b = buckets.setdefault(key, {
            "total": 0, "consistent": 0, "unknown": 0,
            "tier_dist": {},
        })
        b["total"] += 1
        if actual_tier == "UNKNOWN":
            b["unknown"] += 1
        elif is_consistent:
            b["consistent"] += 1
        b["tier_dist"][actual_tier] = b["tier_dist"].get(actual_tier, 0) + 1

    rate = consistent_count / total
    if rate >= 0.95:
        verdict = "PASS"
    elif rate >= 0.80:
        verdict = "CONDITIONAL"
    else:
        verdict = "FAIL"

    return {
        "total": total,
        "consistent": consistent_count,
        "unknown": unknown_count,
        "consistency_rate": rate,
        "unknown_rate": unknown_count / total,
        "verdict": verdict,
        "verdict_rule": "≥95% PASS / 80-94% CONDITIONAL / <80% FAIL",
        "by_prior_claims": buckets,
    }


def format_markdown(result: dict, valuation_date: str) -> str:
    """生成 Markdown 报告。"""
    lines = [
        "# ULR v1 · NCD 时点验证报告",
        "",
        f"**估值日**：{valuation_date} · **样本量**：{result.get('total', 0)}",
        "",
        "## 1. 验证结论",
        "",
        f"- 一致率：**{result.get('consistency_rate', 0) * 100:.2f}%**",
        f"- 未识别率：{result.get('unknown_rate', 0) * 100:.2f}%",
        f"- 判定：**{result.get('verdict', 'N/A')}**（规则：{result.get('verdict_rule', '')}）",
        "",
        "| 判定 | 含义 | 后续行动 |",
        "|---|---|---|",
        "| PASS | 一致率≥95% | `no_claim_bonus` 进入 Prior 模型 |",
        "| CONDITIONAL | 一致率 80-94% | 降级为 Overlay 特征，不进入 Prior |",
        "| FAIL | 一致率<80% | 从模型移除，仅作监控字段 |",
        "",
        "## 2. 按上期出险次数分档",
        "",
        "| 上期出险次数 | 样本量 | 一致 | 未识别 | 一致率 |",
        "|---|---:|---:|---:|---:|",
    ]
    for key in sorted(result.get("by_prior_claims", {}).keys()):
        b = result["by_prior_claims"][key]
        n = b["total"]
        rate_pct = (b["consistent"] / n * 100) if n else 0
        lines.append(
            f"| {key} | {n} | {b['consistent']} | {b['unknown']} | {rate_pct:.2f}% |"
        )

    lines.extend([
        "",
        "## 3. 档位分布（各分档）",
        "",
    ])
    for key in sorted(result.get("by_prior_claims", {}).keys()):
        b = result["by_prior_claims"][key]
        lines.append(f"### {key}")
        lines.append("")
        lines.append("| 档位 | 样本数 | 占比 |")
        lines.append("|---|---:|---:|")
        for tier, cnt in sorted(b["tier_dist"].items(), key=lambda x: -x[1]):
            pct = cnt / b["total"] * 100
            lines.append(f"| {tier} | {cnt} | {pct:.2f}% |")
        lines.append("")

    lines.extend([
        "## 4. 方法备注",
        "",
        "- 抽样：2021-2024 续保单（`is_renewal=true`），储层抽样 1000 条",
        "- 配对：同 `vehicle_frame_no`，起期差 180-540 天",
        "- 上期出险次数：以 `accident_time` 落在上期保单责任期（起期 ~ 起期+1y）内的去重 `claim_no` 计数",
        "- 档位分类函数：`classify_ncd_tier()`（见脚本）",
        "- 宽松匹配：方向一致即视为 consistent（DOWN_1/2/3+ 视同 down，UP/LEVEL 视同 up）",
        "",
    ])
    return "\n".join(lines)


# ============================================================================
# 4. CLI
# ============================================================================

def main() -> int:
    parser = argparse.ArgumentParser(description="ULR v1 NCD 时点验证")
    parser.add_argument("--valuation-date", default=datetime.now().strftime("%Y-%m-%d"),
                        help="估值日（仅用于报告文件名）")
    parser.add_argument("--sample-size", type=int, default=1000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--policy-glob", type=str, default=POLICY_GLOB)
    parser.add_argument("--claims-path", type=str, default=CLAIMS_PATH)
    parser.add_argument("--out-md", type=str, default=None)
    parser.add_argument("--out-json", type=str, default=None)
    args = parser.parse_args()

    con = duckdb.connect(":memory:")

    print(f"[{datetime.now():%H:%M:%S}] 抽样续保对（目标 {args.sample_size} 条）...")
    pairs = sample_renewal_pairs(con, args.sample_size, args.seed,
                                 args.policy_glob, args.claims_path)
    print(f"[{datetime.now():%H:%M:%S}] 实得样本 {len(pairs)} 条")

    result = analyze(pairs)

    date_tag = args.valuation_date.replace("-", "")
    out_md = Path(args.out_md) if args.out_md else REPORT_DIR / f"ulr_v1_ncd_timing_{date_tag}.md"
    out_json = Path(args.out_json) if args.out_json else REPORT_DIR / f"ulr_v1_ncd_timing_{date_tag}.json"

    out_md.parent.mkdir(parents=True, exist_ok=True)
    out_md.write_text(format_markdown(result, args.valuation_date), encoding="utf-8")
    out_json.write_text(json.dumps(result, ensure_ascii=False, indent=2,
                                   default=str), encoding="utf-8")

    print(f"[{datetime.now():%H:%M:%S}] 报告已输出:")
    print(f"  - {out_md}")
    print(f"  - {out_json}")
    print(f"\n判定：{result.get('verdict')}（一致率 {result.get('consistency_rate', 0) * 100:.2f}%）")

    return 0 if result.get("verdict") in ("PASS", "CONDITIONAL") else 1


if __name__ == "__main__":
    raise SystemExit(main())
