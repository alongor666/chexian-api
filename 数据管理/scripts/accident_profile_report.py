#!/usr/bin/env python3
"""
事故画像专项报告生成器

用法:
    python3 数据管理/scripts/accident_profile_report.py --config 数据管理/scripts/accident_profile_configs.json --segment 摩托车
    python3 数据管理/scripts/accident_profile_report.py --config ... --segment all     # 全部生成
    python3 数据管理/scripts/accident_profile_report.py --list                          # 列出所有可用分群

输出: 数据管理/数据分析报告/事故画像/{segment_id}.md

口径:
    - 仅非零赔案（排除零赔报案/撤案）
    - 仅2021-2024年已结案件（排除未成熟赔案）
    - 需有出险经过文字描述
    - 从文本提取: 碰撞对象、事故场景、路段类型
    - 从保单属性: 车龄、驾驶人年龄、NCD、车价、城市
"""

import argparse
import json
import sys
import os
from pathlib import Path
from collections import defaultdict
from datetime import datetime

try:
    import duckdb
except ImportError:
    print("ERROR: duckdb not installed. Run: pip install duckdb", file=sys.stderr)
    sys.exit(1)


# ── 常量 ──

AMT = "COALESCE(cd.settled_amount, 0) + COALESCE(cd.pending_amount, 0)"

# 文本提取规则
TARGET_EXTRACT = """
CASE
    WHEN cd.accident_description LIKE '%行人%' THEN '行人'
    WHEN cd.accident_description LIKE '%电动车%' THEN '电动车'
    WHEN cd.accident_description LIKE '%摩托%' THEN '摩托'
    WHEN cd.accident_description LIKE '%三轮%' THEN '三轮'
    WHEN cd.accident_description LIKE '%自行车%' THEN '自行车'
    WHEN cd.accident_description LIKE '%护栏%' OR cd.accident_description LIKE '%固定物%' OR cd.accident_description LIKE '%树%' THEN '护栏/固定物'
    ELSE '机动车'
END
"""

SCENE_EXTRACT = """
CASE
    WHEN cd.accident_description LIKE '%追尾%' THEN '追尾'
    WHEN cd.accident_description LIKE '%倒车%' THEN '倒车'
    WHEN cd.accident_description LIKE '%变道%' THEN '变道'
    WHEN cd.accident_description LIKE '%逆行%' OR cd.accident_description LIKE '%闯红灯%' THEN '违章'
    WHEN cd.accident_description LIKE '%掉头%' THEN '掉头'
    WHEN cd.accident_description LIKE '%停放%' THEN '停放受损'
    WHEN cd.accident_description LIKE '%侧翻%' OR cd.accident_description LIKE '%翻车%' THEN '侧翻'
    ELSE '一般碰撞'
END
"""

ROAD_EXTRACT = """
CASE
    WHEN cd.accident_description LIKE '%高速%' THEN '高速'
    WHEN cd.accident_description LIKE '%国道%' OR cd.accident_description LIKE '%省道%' THEN '国省道'
    WHEN cd.accident_description LIKE '%停车场%' THEN '停车场'
    WHEN cd.accident_description LIKE '%小区%' THEN '小区'
    WHEN cd.accident_description LIKE '%乡%' OR cd.accident_description LIKE '%村%' THEN '乡村道路'
    WHEN cd.accident_description LIKE '%十字%' OR cd.accident_description LIKE '%丁字%' OR cd.accident_description LIKE '%路口%' THEN '路口'
    ELSE '城市一般道路'
END
"""

TIMESLOT_EXTRACT = """
CASE
    WHEN HOUR(cd.accident_time) BETWEEN 0 AND 5 THEN '凌晨0-5'
    WHEN HOUR(cd.accident_time) BETWEEN 6 AND 8 THEN '早高峰6-8'
    WHEN HOUR(cd.accident_time) BETWEEN 9 AND 11 THEN '上午9-11'
    WHEN HOUR(cd.accident_time) BETWEEN 12 AND 13 THEN '午间12-13'
    WHEN HOUR(cd.accident_time) BETWEEN 14 AND 16 THEN '下午14-16'
    WHEN HOUR(cd.accident_time) BETWEEN 17 AND 19 THEN '晚高峰17-19'
    WHEN HOUR(cd.accident_time) BETWEEN 20 AND 23 THEN '夜间20-23'
END
"""

AGE_TIER_EXTRACT = """
CASE
    WHEN p.driver_age_group LIKE '%＜24%' OR p.driver_age_group LIKE '%<24%' THEN '青年(<24)'
    WHEN p.driver_age_group LIKE '%24%28%' THEN '青壮(24-28)'
    WHEN p.driver_age_group LIKE '%28%36%' THEN '壮年(28-36)'
    WHEN p.driver_age_group LIKE '%36%46%' THEN '中年(36-46)'
    WHEN p.driver_age_group LIKE '%46%61%' THEN '中老(46-61)'
    WHEN p.driver_age_group LIKE '%61%' THEN '老年(61+)'
    ELSE '未知'
END
"""

NCD_TIER_EXTRACT = """
CASE
    WHEN p.commercial_ncd IN ('0.5','0.6','0.7') THEN '优(0.5-0.7)'
    WHEN p.commercial_ncd IN ('0.8','0.85') THEN '良(0.8)'
    WHEN p.commercial_ncd = '1.0' THEN '中(1.0)'
    WHEN TRY_CAST(p.commercial_ncd AS DOUBLE) > 1.0 THEN '差(>1.0)'
    ELSE '无NCD'
END
"""

VEHICLE_AGE_EXTRACT = """
YEAR(cd.accident_time) - COALESCE(
    TRY_CAST(LEFT(p.first_registration_date, 4) AS INT),
    YEAR(cd.accident_time)
)
"""

TIME_ORDER = ['凌晨0-5', '早高峰6-8', '上午9-11', '午间12-13', '下午14-16', '晚高峰17-19', '夜间20-23']
TARGET_ORDER = ['机动车', '电动车', '摩托', '三轮', '行人', '自行车', '护栏/固定物']
SCENE_ORDER = ['追尾', '倒车', '变道', '掉头', '违章', '停放受损', '侧翻', '一般碰撞']
ROAD_ORDER = ['高速', '国省道', '路口', '城市一般道路', '小区', '停车场', '乡村道路']


def get_project_root():
    """定位项目根目录"""
    p = Path(__file__).resolve()
    for parent in p.parents:
        if (parent / "CLAUDE.md").exists():
            return parent
    return Path.cwd()


def _policy_glob() -> str:
    """policy/current 双布局自适应 glob（branch_paths SSOT · 801409 cutover 前置）。

    本脚本历史即为跨省全量读（未按 branch_code 过滤），布局适配保持行为等价；
    混省口径问题另行治理（memory fact-current-mixes-sc-sx-bare-glob）。
    """
    root = get_project_root()
    dm = str(root / "数据管理")
    if dm not in sys.path:
        sys.path.insert(0, dm)
    from pipelines.branch_paths import policy_current_glob
    return policy_current_glob(root / "数据管理/warehouse/fact/policy/current", missing_ok=True)


def build_base_query(segment_filter: str) -> str:
    """构建基础 FROM + WHERE 子句"""
    return f"""
    FROM read_parquet('{get_project_root()}/数据管理/warehouse/fact/claims_detail/claims_*.parquet') cd
    JOIN read_parquet('{_policy_glob()}') p
        ON cd.policy_no = p.policy_no
    WHERE {AMT} > 0
      AND cd.accident_description IS NOT NULL AND LENGTH(cd.accident_description) > 5
      AND YEAR(cd.accident_time) BETWEEN 2021 AND 2024
      AND ({segment_filter})
    """


def generate_report(con, segment_name: str, segment_filter: str) -> str:
    """生成一个分群的完整事故画像报告，返回 Markdown 字符串"""

    BASE = build_base_query(segment_filter)
    lines = []

    def out(s=""):
        lines.append(s)

    # ── 0. 基线 ──
    row = con.execute(f"""
    SELECT
        COUNT(*) as n,
        SUM({AMT})/10000 as total_wan,
        MEDIAN({AMT}) as med,
        PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY {AMT}) as p90,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY {AMT}) as p99,
        SUM(CASE WHEN {AMT}>=50000 THEN 1.0 ELSE 0 END)/COUNT(*) as big_rate,
        SUM(CASE WHEN cd.is_bodily_injury THEN 1.0 ELSE 0 END)/COUNT(*) as bi_rate,
        SUM(CASE WHEN cd.is_bodily_injury THEN {AMT} ELSE 0 END)/NULLIF(SUM({AMT}),0) as bi_amt_pct
    {BASE}
    """).fetchone()

    if not row or row[0] == 0:
        return f"# {segment_name}\n\n该分群无有效赔案数据。\n"

    n = row[0]
    out(f"# {segment_name} — 事故画像报告")
    out(f"\n> 生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    out(f"> 口径: 非零赔案 | 2021-2024已结 | 有文字描述")
    out()
    out("## 基线")
    out()
    out(f"| 指标 | 值 |")
    out(f"|------|-----|")
    out(f"| 有效赔案 | {n:,} |")
    out(f"| 总赔款 | {row[1]:,.0f} 万元 |")
    out(f"| 中位赔款 | {row[2]:,.0f} 元 |")
    out(f"| P90 | {row[3]:,.0f} 元 |")
    out(f"| P99 | {row[4]:,.0f} 元 |")
    out(f"| 大额率(>=5万) | {row[5]:.1%} |")
    out(f"| 人伤率 | {row[6]:.1%} |")
    out(f"| 人伤赔款占比 | {row[7]:.0%} |")

    min_n = 10  # 最小样本量阈值

    # ── 1. 时段 × 路段 ──
    out()
    out("## 1. 时段 x 路段")
    out()

    rows = con.execute(f"""
    SELECT {TIMESLOT_EXTRACT} as ts, {ROAD_EXTRACT} as rd,
        COUNT(*) as n,
        SUM(CASE WHEN cd.is_bodily_injury THEN 1.0 ELSE 0 END)/COUNT(*) as bi
    {BASE}
    GROUP BY 1, 2 HAVING COUNT(*) >= {min_n} ORDER BY 1, 2
    """).fetchall()

    grid = defaultdict(dict)
    active_roads = set()
    for ts, rd, cnt, bi in rows:
        grid[ts][rd] = (cnt, bi)
        active_roads.add(rd)

    roads = [r for r in ROAD_ORDER if r in active_roads]
    if roads:
        out(f"| 时段 | " + " | ".join(roads) + " |")
        out("|---" + "|---" * len(roads) + "|")
        for ts in TIME_ORDER:
            cells = []
            for rd in roads:
                if rd in grid.get(ts, {}):
                    cnt, bi = grid[ts][rd]
                    cells.append(f"{cnt} ({bi:.0%})")
                else:
                    cells.append("—")
            out(f"| {ts} | " + " | ".join(cells) + " |")
        out(f"\n*单元格格式: 件数 (人伤率)*")

    # ── 2. 碰撞对象构成 ──
    out()
    out("## 2. 碰撞对象构成")
    out()

    rows = con.execute(f"""
    SELECT {TARGET_EXTRACT} as tgt, COUNT(*) as n,
        COUNT(*)*100.0/(SELECT COUNT(*) {BASE}) as pct,
        MEDIAN({AMT}) as med,
        SUM(CASE WHEN cd.is_bodily_injury THEN 1.0 ELSE 0 END)/COUNT(*) as bi
    {BASE}
    GROUP BY 1 ORDER BY n DESC
    """).fetchall()

    out("| 碰撞对象 | 件数 | 占比 | 中位赔 | 人伤率 |")
    out("|---------|------|------|--------|--------|")
    for tgt, cnt, pct, med, bi in rows:
        out(f"| {tgt} | {cnt:,} | {pct:.1f}% | {med:,.0f} | {bi:.1%} |")

    # ── 3. 事故场景构成 ──
    out()
    out("## 3. 事故场景构成")
    out()

    rows = con.execute(f"""
    SELECT {SCENE_EXTRACT} as sc, COUNT(*) as n,
        COUNT(*)*100.0/(SELECT COUNT(*) {BASE}) as pct,
        MEDIAN({AMT}) as med,
        SUM(CASE WHEN cd.is_bodily_injury THEN 1.0 ELSE 0 END)/COUNT(*) as bi
    {BASE}
    GROUP BY 1 ORDER BY n DESC
    """).fetchall()

    out("| 场景 | 件数 | 占比 | 中位赔 | 人伤率 |")
    out("|------|------|------|--------|--------|")
    for sc, cnt, pct, med, bi in rows:
        out(f"| {sc} | {cnt:,} | {pct:.1f}% | {med:,.0f} | {bi:.1%} |")

    # ── 4. 碰撞对象 × 时段 ──
    out()
    out("## 4. 碰撞对象 x 时段")
    out()

    rows = con.execute(f"""
    SELECT {TIMESLOT_EXTRACT} as ts, {TARGET_EXTRACT} as tgt,
        COUNT(*)*100.0/SUM(COUNT(*)) OVER (PARTITION BY {TIMESLOT_EXTRACT}) as pct
    {BASE}
    GROUP BY 1, 2 ORDER BY 1, 2
    """).fetchall()

    tgt_grid = defaultdict(dict)
    for ts, tgt, pct in rows:
        tgt_grid[ts][tgt] = pct

    active_targets = [t for t in TARGET_ORDER if any(t in tgt_grid.get(ts, {}) for ts in TIME_ORDER)]
    if active_targets:
        out(f"| 时段 | " + " | ".join(active_targets) + " |")
        out("|---" + "|---" * len(active_targets) + "|")
        for ts in TIME_ORDER:
            cells = [f"{tgt_grid.get(ts, {}).get(t, 0):.1f}%" for t in active_targets]
            out(f"| {ts} | " + " | ".join(cells) + " |")

    # ── 5. 驾驶人年龄 × 时段 ──
    out()
    out("## 5. 驾驶人年龄 x 时段")
    out()

    rows = con.execute(f"""
    SELECT {AGE_TIER_EXTRACT} as age, {TIMESLOT_EXTRACT} as ts,
        COUNT(*)*100.0/SUM(COUNT(*)) OVER (PARTITION BY {AGE_TIER_EXTRACT}) as pct
    {BASE} AND ({AGE_TIER_EXTRACT}) != '未知'
    GROUP BY 1, 2 ORDER BY 1, 2
    """).fetchall()

    age_grid = defaultdict(dict)
    age_list = []
    for a, ts, pct in rows:
        age_grid[a][ts] = pct
        if a not in age_list:
            age_list.append(a)

    if age_list:
        out(f"| 年龄 | " + " | ".join(TIME_ORDER) + " |")
        out("|---" + "|---" * len(TIME_ORDER) + "|")
        for a in sorted(age_list):
            cells = [f"{age_grid[a].get(ts, 0):.1f}%" for ts in TIME_ORDER]
            out(f"| {a} | " + " | ".join(cells) + " |")

    # ── 6. 驾驶人年龄 × 事故场景 ──
    out()
    out("## 6. 驾驶人年龄 x 事故场景")
    out()

    rows = con.execute(f"""
    SELECT {AGE_TIER_EXTRACT} as age, {SCENE_EXTRACT} as sc,
        COUNT(*)*100.0/SUM(COUNT(*)) OVER (PARTITION BY {AGE_TIER_EXTRACT}) as pct
    {BASE} AND ({AGE_TIER_EXTRACT}) != '未知'
    GROUP BY 1, 2 ORDER BY 1, 2
    """).fetchall()

    sc_grid = defaultdict(dict)
    for a, sc, pct in rows:
        sc_grid[a][sc] = pct

    if age_list:
        out(f"| 年龄 | " + " | ".join(SCENE_ORDER) + " |")
        out("|---" + "|---" * len(SCENE_ORDER) + "|")
        for a in sorted(age_list):
            cells = [f"{sc_grid[a].get(s, 0):.1f}%" for s in SCENE_ORDER]
            out(f"| {a} | " + " | ".join(cells) + " |")

    # ── 7. NCD × 事故场景（仅有 NCD 数据时） ──
    ncd_count = con.execute(f"""
    SELECT COUNT(*) {BASE} AND p.commercial_ncd IS NOT NULL AND p.commercial_ncd != ''
    """).fetchone()[0]

    if ncd_count > 100:
        out()
        out("## 7. NCD x 事故场景")
        out()

        rows = con.execute(f"""
        SELECT {NCD_TIER_EXTRACT} as ncd, {SCENE_EXTRACT} as sc,
            COUNT(*)*100.0/SUM(COUNT(*)) OVER (PARTITION BY {NCD_TIER_EXTRACT}) as pct
        {BASE}
        GROUP BY 1, 2 ORDER BY 1, 2
        """).fetchall()

        ncd_grid = defaultdict(dict)
        ncd_list = []
        for ncd, sc, pct in rows:
            ncd_grid[ncd][sc] = pct
            if ncd not in ncd_list:
                ncd_list.append(ncd)

        out(f"| NCD | " + " | ".join(SCENE_ORDER) + " |")
        out("|---" + "|---" * len(SCENE_ORDER) + "|")
        for ncd in ncd_list:
            cells = [f"{ncd_grid[ncd].get(s, 0):.1f}%" for s in SCENE_ORDER]
            out(f"| {ncd} | " + " | ".join(cells) + " |")

    # ── 8. 车龄 × 碰撞对象 ──
    out()
    out("## 8. 车龄 x 碰撞对象")
    out()

    rows = con.execute(f"""
    SELECT
        CASE
            WHEN ({VEHICLE_AGE_EXTRACT}) <= 2 THEN '≤2年'
            WHEN ({VEHICLE_AGE_EXTRACT}) <= 6 THEN '3-6年'
            ELSE '7年+'
        END as at,
        {TARGET_EXTRACT} as tgt,
        COUNT(*)*100.0/SUM(COUNT(*)) OVER (PARTITION BY
            CASE WHEN ({VEHICLE_AGE_EXTRACT}) <= 2 THEN '≤2年'
                 WHEN ({VEHICLE_AGE_EXTRACT}) <= 6 THEN '3-6年' ELSE '7年+' END
        ) as pct
    {BASE} AND ({VEHICLE_AGE_EXTRACT}) BETWEEN 0 AND 20
    GROUP BY 1, 2 ORDER BY 1, 2
    """).fetchall()

    at_grid = defaultdict(dict)
    for at, tgt, pct in rows:
        at_grid[at][tgt] = pct

    out(f"| 车龄 | " + " | ".join(TARGET_ORDER) + " |")
    out("|---" + "|---" * len(TARGET_ORDER) + "|")
    for at in ['≤2年', '3-6年', '7年+']:
        cells = [f"{at_grid.get(at, {}).get(t, 0):.1f}%" for t in TARGET_ORDER]
        out(f"| {at} | " + " | ".join(cells) + " |")

    # ── 9. 出险城市 TOP10 ──
    out()
    out("## 9. 出险城市 TOP10")
    out()

    rows = con.execute(f"""
    SELECT
        COALESCE(cd.accident_city, '未知') as city,
        COUNT(*) as n,
        SUM(CASE WHEN ({TARGET_EXTRACT}) IN ('电动车','摩托','三轮','行人','自行车') THEN 1.0 ELSE 0 END)/COUNT(*) as vuln,
        SUM(CASE WHEN ({SCENE_EXTRACT})='追尾' THEN 1.0 ELSE 0 END)/COUNT(*) as re,
        SUM(CASE WHEN ({ROAD_EXTRACT})='高速' THEN 1.0 ELSE 0 END)/COUNT(*) as hw,
        SUM(CASE WHEN cd.is_bodily_injury THEN 1.0 ELSE 0 END)/COUNT(*) as bi,
        SUM(CASE WHEN ({TIMESLOT_EXTRACT})='凌晨0-5' THEN 1.0 ELSE 0 END)/COUNT(*) as dawn
    {BASE}
    GROUP BY 1 HAVING COUNT(*) >= 30
    ORDER BY n DESC LIMIT 10
    """).fetchall()

    out("| 城市 | 件数 | 弱势方率 | 追尾率 | 高速率 | 人伤率 | 凌晨率 |")
    out("|------|------|---------|--------|--------|--------|--------|")
    for city, cnt, vuln, re, hw, bi, dawn in rows:
        out(f"| {city} | {cnt:,} | {vuln:.1%} | {re:.1%} | {hw:.1%} | {bi:.1%} | {dawn:.1%} |")

    # ── 10. 样本量警告 ──
    if n < 200:
        out()
        out(f"> **样本量警告**: 本分群仅 {n:,} 件有效赔案，部分交叉分析结果统计稳定性不足，仅供参考。")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="事故画像专项报告生成器")
    parser.add_argument("--config", type=str, help="分群配置 JSON 文件路径")
    parser.add_argument("--segment", type=str, help="分群ID（或 'all' 全部生成）")
    parser.add_argument("--list", action="store_true", help="列出所有可用分群")
    parser.add_argument("--output-dir", type=str, default=None, help="输出目录")
    args = parser.parse_args()

    if args.list and not args.config:
        print("需要指定 --config")
        sys.exit(1)

    if not args.config:
        # 默认配置路径
        args.config = str(get_project_root() / "数据管理/scripts/accident_profile_configs.json")

    with open(args.config, "r") as f:
        configs = json.load(f)

    if args.list:
        print("可用分群:")
        for seg in configs:
            print(f"  {seg['id']:<30} {seg['name']}")
        sys.exit(0)

    if not args.segment:
        print("需要指定 --segment")
        sys.exit(1)

    output_dir = Path(args.output_dir) if args.output_dir else get_project_root() / "数据管理/数据分析报告/事故画像"
    output_dir.mkdir(parents=True, exist_ok=True)

    con = duckdb.connect()

    if args.segment == "all":
        targets = configs
    else:
        targets = [s for s in configs if s["id"] == args.segment]
        if not targets:
            print(f"ERROR: 分群 '{args.segment}' 不存在。使用 --list 查看可用分群。")
            sys.exit(1)

    for seg in targets:
        print(f"生成: {seg['name']} ...", end=" ", flush=True)
        report = generate_report(con, seg["name"], seg["filter"])
        out_path = output_dir / f"{seg['id']}.md"
        out_path.write_text(report, encoding="utf-8")
        print(f"→ {out_path}")

    print(f"\n完成，共生成 {len(targets)} 份报告。")


if __name__ == "__main__":
    main()
