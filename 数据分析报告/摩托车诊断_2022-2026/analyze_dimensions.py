"""摩托车交强险 9 维度分析 — 找出保费占比低但赔付影响度高的毒瘤板块"""
import duckdb, json, os

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
PARQUET = '数据管理/warehouse/fact/policy/current/*.parquet'
FILTER = "客户类别 = '摩托车'"
YEARS = "EXTRACT(YEAR FROM 保险起期) BETWEEN 2022 AND 2026"

con = duckdb.connect()

# --- 公共模板 ---
def run_dimension(dim_name: str, dim_expr: str, *, min_policies: int = 50, top_n: int = 50) -> list[dict]:
    """对单个维度做聚合，返回 list[dict]，含保费占比和赔付贡献度"""
    sql = f"""
    WITH base AS (
      SELECT *,
        {dim_expr} AS dim_value
      FROM read_parquet('{PARQUET}')
      WHERE {FILTER} AND {YEARS}
    ),
    totals AS (
      SELECT SUM(保费) AS t_prem, SUM(已报告赔款) AS t_claim, COUNT(*) AS t_cnt
      FROM base
    ),
    agg AS (
      SELECT
        dim_value,
        COUNT(*) AS 保单数,
        ROUND(SUM(保费)/10000, 2) AS 保费万,
        ROUND(SUM(已报告赔款)/10000, 2) AS 赔款万,
        ROUND(SUM(保费)/COUNT(*), 0) AS 件均保费,
        ROUND(SUM(已报告赔款)/NULLIF(SUM(保费 * LEAST(
          EXTRACT(EPOCH FROM AGE(CURRENT_DATE, 保险起期))
          / EXTRACT(EPOCH FROM INTERVAL '365 days'), 1.0
        )),0)*100, 1) AS 满期赔付率,
        ROUND(SUM(赔案件数)*100.0/NULLIF(COUNT(*),0), 2) AS 出险率,
        ROUND(SUM(已报告赔款)/NULLIF(SUM(赔案件数),0), 0) AS 案均赔款,
        -- 保费占比
        ROUND(SUM(保费)*100.0 / (SELECT t_prem FROM totals), 2) AS 保费占比,
        -- 赔付贡献度（赔款占总赔款比例）
        ROUND(SUM(已报告赔款)*100.0 / NULLIF((SELECT t_claim FROM totals),0), 2) AS 赔付贡献度
      FROM base, totals
      GROUP BY dim_value
      HAVING COUNT(*) >= {min_policies}
    )
    SELECT *,
      -- 毒性指数 = 赔付贡献度 / 保费占比（>1 表示赔付影响超过保费贡献）
      ROUND(赔付贡献度 / NULLIF(保费占比, 0), 2) AS 毒性指数
    FROM agg
    ORDER BY 毒性指数 DESC NULLS LAST
    LIMIT {top_n}
    """
    rows = con.execute(sql).fetchall()
    cols = [d[0] for d in con.description]
    return [dict(zip(cols, r)) for r in rows]


# --- 9 个维度定义 ---
DIMENSIONS = {
    "1_被保险人年龄": "COALESCE(被保险人年龄分组, '未知')",

    "2_车牌归属地": """CASE
      WHEN LEFT(车牌号码, 2) = '川Q' THEN '川Q-宜宾'
      WHEN LEFT(车牌号码, 2) = '川M' THEN '川M-资阳'
      WHEN LEFT(车牌号码, 2) = '川E' THEN '川E-泸州'
      WHEN LEFT(车牌号码, 2) = '川C' THEN '川C-自贡'
      WHEN LEFT(车牌号码, 2) = '川L' THEN '川L-乐山'
      WHEN LEFT(车牌号码, 2) = '川A' THEN '川A-成都'
      WHEN LEFT(车牌号码, 2) = '川R' THEN '川R-南充'
      WHEN LEFT(车牌号码, 2) = '川F' THEN '川F-德阳'
      WHEN LEFT(车牌号码, 2) = '川X' THEN '川X-达州'
      WHEN LEFT(车牌号码, 2) = '*-' THEN '临牌/新车'
      ELSE COALESCE(LEFT(车牌号码, 2), '未知') || '-其他'
    END""",

    "3_车型": """CASE
      WHEN 厂牌车型 LIKE '%三轮%' THEN '三轮摩托车'
      WHEN 厂牌车型 LIKE '%轻便%' THEN '轻便摩托车'
      WHEN 厂牌车型 LIKE '%电动%' OR 是否新能源 THEN '电动摩托车'
      WHEN 厂牌车型 LIKE '%125%' THEN '125cc级'
      WHEN 厂牌车型 LIKE '%150%' THEN '150cc级'
      WHEN 厂牌车型 LIKE '%110%' THEN '110cc级'
      WHEN 厂牌车型 LIKE '%200%' OR 厂牌车型 LIKE '%250%' OR 厂牌车型 LIKE '%300%'
           OR 厂牌车型 LIKE '%400%' OR 厂牌车型 LIKE '%500%' OR 厂牌车型 LIKE '%600%'
           OR 厂牌车型 LIKE '%700%' OR 厂牌车型 LIKE '%800%' THEN '200cc以上'
      WHEN 厂牌车型 LIKE '%48%' OR 厂牌车型 LIKE '%50%' OR 厂牌车型 LIKE '%70%'
           OR 厂牌车型 LIKE '%90%' OR 厂牌车型 LIKE '%100%' THEN '100cc及以下'
      ELSE '其他/未分类'
    END""",

    "4_新旧车": """CASE
      WHEN 是否新车 THEN '新车'
      WHEN 是否过户车 THEN '过户车'
      WHEN 是否续保 THEN '续保'
      ELSE '转保'
    END""",

    "5_车价": """CASE
      WHEN 新车购置价 IS NULL OR 新车购置价 <= 0 THEN '未知'
      WHEN 新车购置价 <= 3000 THEN '≤3千'
      WHEN 新车购置价 <= 5000 THEN '3-5千'
      WHEN 新车购置价 <= 8000 THEN '5-8千'
      WHEN 新车购置价 <= 15000 THEN '0.8-1.5万'
      WHEN 新车购置价 <= 30000 THEN '1.5-3万'
      ELSE '3万以上'
    END""",

    "6_车龄": """CASE
      WHEN 初次登记年月 IS NULL OR 初次登记年月 = '' THEN '新车/未知'
      WHEN EXTRACT(YEAR FROM AGE(保险起期, TRY_CAST(初次登记年月 AS DATE))) <= 1 THEN '0-1年'
      WHEN EXTRACT(YEAR FROM AGE(保险起期, TRY_CAST(初次登记年月 AS DATE))) <= 3 THEN '2-3年'
      WHEN EXTRACT(YEAR FROM AGE(保险起期, TRY_CAST(初次登记年月 AS DATE))) <= 5 THEN '4-5年'
      WHEN EXTRACT(YEAR FROM AGE(保险起期, TRY_CAST(初次登记年月 AS DATE))) <= 8 THEN '6-8年'
      WHEN EXTRACT(YEAR FROM AGE(保险起期, TRY_CAST(初次登记年月 AS DATE))) <= 12 THEN '9-12年'
      ELSE '12年以上'
    END""",

    "7_业务员": "COALESCE(业务员, '未知')",

    "8_经代": "COALESCE(经代名, '直销')",

    "9_能源": """CASE WHEN 是否新能源 THEN '新能源' ELSE '燃油' END""",
}


# --- 执行并输出 ---
all_results = {}
toxic_summary = []  # 汇总毒瘤板块

for dim_name, dim_expr in DIMENSIONS.items():
    print(f"分析: {dim_name} ...", flush=True)
    min_p = 20 if dim_name in ("7_业务员", "8_经代") else 50
    top = 80 if dim_name in ("7_业务员", "8_经代") else 50
    result = run_dimension(dim_name, dim_expr, min_policies=min_p, top_n=top)
    all_results[dim_name] = result

    # 写单维度 JSON
    out_path = os.path.join(OUT_DIR, f"dim_{dim_name}.json")
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump({"dimension": dim_name, "data": result}, f, ensure_ascii=False, indent=2)
    print(f"  ✅ {out_path} ({len(result)} 行)")

    # 收集毒瘤（毒性指数>1.3 且 赔付率>120%）
    for row in result:
        toxicity = row.get('毒性指数') or 0
        loss_ratio = row.get('满期赔付率') or 0
        prem_pct = row.get('保费占比') or 0
        claim_pct = row.get('赔付贡献度') or 0
        if toxicity > 1.3 and loss_ratio > 120 and prem_pct > 0.5:
            toxic_summary.append({
                '维度': dim_name,
                '值': row['dim_value'],
                '保费占比%': prem_pct,
                '赔付贡献度%': claim_pct,
                '毒性指数': toxicity,
                '满期赔付率%': loss_ratio,
                '保费万': row['保费万'],
                '赔款万': row['赔款万'],
                '保单数': row['保单数'],
                '出险率%': row.get('出险率', 0),
                '案均赔款': row.get('案均赔款', 0),
            })

# 按毒性指数排序
toxic_summary.sort(key=lambda x: x['毒性指数'], reverse=True)

# 写毒瘤汇总
toxic_path = os.path.join(OUT_DIR, "toxic_segments.json")
with open(toxic_path, 'w', encoding='utf-8') as f:
    json.dump(toxic_summary, f, ensure_ascii=False, indent=2)
print(f"\n🔴 毒瘤板块汇总: {toxic_path} ({len(toxic_summary)} 项)")

# 同时找盈利池（毒性指数<0.8 且 赔付率<100%）
profitable = []
for dim_name, result in all_results.items():
    for row in result:
        toxicity = row.get('毒性指数') or 999
        loss_ratio = row.get('满期赔付率') or 999
        prem_pct = row.get('保费占比') or 0
        if toxicity < 0.8 and loss_ratio < 100 and prem_pct > 0.3:
            profitable.append({
                '维度': dim_name,
                '值': row['dim_value'],
                '保费占比%': prem_pct,
                '赔付贡献度%': row.get('赔付贡献度', 0),
                '毒性指数': toxicity,
                '满期赔付率%': loss_ratio,
                '保费万': row['保费万'],
                '保单数': row['保单数'],
            })
profitable.sort(key=lambda x: x['毒性指数'])

profit_path = os.path.join(OUT_DIR, "profitable_segments.json")
with open(profit_path, 'w', encoding='utf-8') as f:
    json.dump(profitable, f, ensure_ascii=False, indent=2)
print(f"🟢 盈利池汇总: {profit_path} ({len(profitable)} 项)")
