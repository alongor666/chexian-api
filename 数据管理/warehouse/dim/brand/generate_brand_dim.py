#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
品牌维度表生成器 — 从厂牌车型字段提取品牌+车辆用途

产出:
  - dim/brand/latest.parquet  (品牌维度表)
  - knowledge/ai/BRAND_KNOWLEDGE.md (AI 知识文件)

使用:
  python3 数据管理/warehouse/dim/brand/generate_brand_dim.py

架构:
  厂牌车型 = 品牌前缀(中文) + 型号代码(字母数字) + 用途后缀(中文)
  例: "长安SC6399D4Y客车" → 品牌=长安, 型号=SC6399D4Y, 用途=客车

  特殊处理:
  - 连字符品牌: 五羊-本田, 新大洲-本田, 梅赛德斯-奔驰, 轻骑-铃木
  - 品牌标准化: 大众汽车→大众, 长安牌→长安, 东风雪铁龙牌→东风雪铁龙
  - 无法解析的记录(VIN开头等): 品牌='其他', 用途='未知'

版本: 1.0.0
日期: 2026-04-01
"""

import json
import re
import sys
from datetime import datetime
from pathlib import Path

try:
    import duckdb
except ImportError:
    print("错误: pip3 install duckdb")
    sys.exit(1)


SCRIPT_DIR = Path(__file__).resolve().parent
DIM_DIR = SCRIPT_DIR  # dim/brand/
WAREHOUSE_ROOT = SCRIPT_DIR.parent.parent  # 数据管理/warehouse/
PROJECT_ROOT = WAREHOUSE_ROOT.parent.parent  # chexian-api/
GLOB = str(WAREHOUSE_ROOT / "fact/policy/current/*.parquet")
KNOWLEDGE_DIR = WAREHOUSE_ROOT.parent / "knowledge/ai"

# 品牌标准化映射（去除"牌"/"汽车"后缀，合并同品牌异名）
BRAND_NORMALIZE = {
    "大众汽车": "大众",
    "长安牌": "长安",
    "东风雪铁龙牌": "东风雪铁龙",
    "北京现代牌": "北京现代",
    "北京牌": "北京",
    "福克斯牌": "福克斯",
    "大众汽车牌": "大众",
    "别克牌": "别克",
    "奥迪牌": "奥迪",
    "炫威牌": "炫威",
    "梅赛德斯奔驰": "梅赛德斯-奔驰",
}

# 用途后缀标准化（合并近义后缀到大类）
USAGE_NORMALIZE = {
    "纯电动轿车": "轿车",
    "两用燃料轿车": "轿车",
    "插电式混合动力轿车": "轿车",
    "纯电动多用途乘用车": "多用途乘用车",
    "插电式混合动力多用途乘用车": "多用途乘用车",
    "电动两轮摩托车": "两轮摩托车",
    "电动两轮轻便摩托车": "两轮摩托车",
    "电动正三轮摩托车": "三轮摩托车",
    "轻型载货汽车": "载货汽车",
    "重型载货汽车": "载货汽车",
    "中型载货汽车": "载货汽车",
    "微型载货汽车": "载货汽车",
    "轻型客车": "客车",
    "中型客车": "客车",
    "大型客车": "客车",
}

# 用途大类映射（用于 AI 快速分类）
USAGE_CATEGORY = {
    "轿车": "乘用车",
    "多用途乘用车": "乘用车",
    "越野车": "乘用车",
    "旅行车": "乘用车",
    "客车": "乘用车",
    "两轮摩托车": "摩托车",
    "三轮摩托车": "摩托车",
    "摩托车": "摩托车",
    "载货汽车": "货车",
    "货车": "货车",
    "仓栅式运输车": "货车",
    "厢式运输车": "货车",
    "多用途货车": "货车",
    "自卸汽车": "货车",
    "半挂牵引车": "货车",
}

# 品牌前缀正则：匹配开头连续中文(含连字符)
RE_BRAND = re.compile(r'^([\u4e00-\u9fff][\u4e00-\u9fff\uff0d\-]*)')
# 用途后缀正则：匹配末尾连续中文
RE_USAGE = re.compile(r'([\u4e00-\u9fff]+)$')


def extract_brand_usage(raw: str) -> tuple:
    """从厂牌车型提取 (品牌, 用途)"""
    if not raw or not raw.strip():
        return ("其他", "未知")

    brand_m = RE_BRAND.match(raw)
    usage_m = RE_USAGE.search(raw)

    brand = brand_m.group(1) if brand_m else "其他"
    usage = usage_m.group(1) if usage_m else "未知"

    # 品牌标准化
    brand = BRAND_NORMALIZE.get(brand, brand)
    # 去除末尾"牌"字
    if brand.endswith("牌") and len(brand) > 1:
        brand = brand[:-1]

    # 用途标准化
    usage = USAGE_NORMALIZE.get(usage, usage)

    return (brand, usage)


def generate():
    con = duckdb.connect()

    print("📊 读取保单数据...")
    # 兼容中英文列名：优先英文 vehicle_model，回退中文 厂牌车型
    parquet_cols = [c[0] for c in con.execute(f"SELECT name FROM parquet_schema('{GLOB}')").fetchall()]
    model_col = 'vehicle_model' if 'vehicle_model' in parquet_cols else '厂牌车型'
    policy_no_col = 'policy_no' if 'policy_no' in parquet_cols else '保单号'
    premium_col = 'premium' if 'premium' in parquet_cols else '保费'
    if model_col != 'vehicle_model':
        print(f"   ⚠️ Parquet 仍为中文列名，使用回退: {model_col}")
    rows = con.execute(f"""
        SELECT DISTINCT "{model_col}"
        FROM read_parquet('{GLOB}', union_by_name=true)
        WHERE "{model_col}" IS NOT NULL AND "{model_col}" != ''
    """).fetchall()

    print(f"   唯一厂牌车型: {len(rows):,d}")

    # 提取品牌+用途
    records = []
    for (raw,) in rows:
        brand, usage = extract_brand_usage(raw)
        usage_cat = USAGE_CATEGORY.get(usage, "其他")
        brand_usage = f"{brand}_{usage}"
        records.append((raw, brand, usage, usage_cat, brand_usage))

    # 写入 Parquet（英文列名）
    con.execute("DROP TABLE IF EXISTS brand_dim_tmp")
    con.execute("""
        CREATE TABLE brand_dim_tmp (
            vehicle_model VARCHAR,
            brand VARCHAR,
            vehicle_usage VARCHAR,
            usage_category VARCHAR,
            brand_usage VARCHAR
        )
    """)
    con.executemany(
        "INSERT INTO brand_dim_tmp VALUES (?, ?, ?, ?, ?)",
        records
    )

    out_path = DIM_DIR / "latest.parquet"
    con.execute(f"COPY brand_dim_tmp TO '{out_path}' (FORMAT PARQUET, COMPRESSION ZSTD)")
    count = con.execute("SELECT COUNT(*) FROM brand_dim_tmp").fetchone()[0]
    print(f"✅ 维度表已生成: {out_path} ({count:,d} 条)")

    # 统计品牌分布（带保单量）
    print("📊 统计品牌分布...")
    brand_stats = con.execute(f"""
        SELECT
            b.brand_usage,
            b.brand,
            b.usage_category,
            COUNT(DISTINCT p."{policy_no_col}") AS policy_count,
            ROUND(SUM(p."{premium_col}")/10000, 0)::INT AS premium_wan,
            COUNT(DISTINCT b.vehicle_model) AS model_count
        FROM read_parquet('{GLOB}', union_by_name=true) p
        JOIN brand_dim_tmp b ON p."{model_col}" = b.vehicle_model
        GROUP BY b.brand_usage, b.brand, b.usage_category
        HAVING COUNT(DISTINCT p."{policy_no_col}") >= 100
        ORDER BY COUNT(DISTINCT p."{policy_no_col}") DESC
    """).fetchall()

    usage_stats = con.execute(f"""
        SELECT
            b.vehicle_usage,
            b.usage_category,
            COUNT(DISTINCT p."{policy_no_col}") AS policy_count,
            ROUND(SUM(p."{premium_col}")/10000, 0)::INT AS premium_wan
        FROM read_parquet('{GLOB}', union_by_name=true) p
        JOIN brand_dim_tmp b ON p."{model_col}" = b.vehicle_model
        GROUP BY b.vehicle_usage, b.usage_category
        ORDER BY COUNT(DISTINCT p."{policy_no_col}") DESC
    """).fetchall()

    # 生成 AI 知识文件
    _write_knowledge(brand_stats, usage_stats, count)

    # 统计唯一品牌_用途组合数
    combo_count = con.execute("SELECT COUNT(DISTINCT brand_usage) FROM brand_dim_tmp").fetchone()[0]
    print(f"   唯一品牌_用途组合: {combo_count:,d}")

    # 更新 dim_summary.json
    _update_summary(count, combo_count)

    con.close()


def _write_knowledge(brand_stats, usage_stats, total_models):
    """生成 AI 可高效理解的品牌知识文件"""
    lines = []
    lines.append("# 品牌维度知识库 (Brand Dimension Knowledge)")
    lines.append("")
    lines.append(f"**更新时间**: {datetime.now().strftime('%Y-%m-%d')}")
    lines.append(f"**唯一厂牌车型数**: {total_models:,d}")
    lines.append(f"**数据源**: `warehouse/fact/policy/current/*.parquet` → `dim/brand/latest.parquet`")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## 1. 解析规则")
    lines.append("")
    lines.append("```")
    lines.append("厂牌车型 = 品牌(中文前缀) + 型号代码(字母数字) + 车辆用途(中文后缀)")
    lines.append("")
    lines.append("示例:")
    lines.append("  长安SC6399D4Y客车      → 品牌_用途=长安_客车,           大类=乘用车")
    lines.append("  豪爵HJ150-30F两轮摩托车 → 品牌_用途=豪爵_两轮摩托车,     大类=摩托车")
    lines.append("  五菱LZW1029PYA货车      → 品牌_用途=五菱_货车,           大类=货车")
    lines.append("  梅赛德斯-奔驰GLC300越野车 → 品牌_用途=梅赛德斯-奔驰_越野车, 大类=乘用车")
    lines.append("```")
    lines.append("")
    lines.append("**品牌标准化**: 大众汽车→大众, XX牌→XX, 梅赛德斯奔驰→梅赛德斯-奔驰")
    lines.append("")
    lines.append("**用途标准化**: 纯电动轿车/两用燃料轿车→轿车, 电动两轮摩托车→两轮摩托车, 轻型载货汽车→载货汽车")
    lines.append("")
    lines.append("**用途大类**: 乘用车(轿车/越野车/客车/MPV) | 摩托车(两轮/三轮) | 货车(载货/厢式/仓栅/牵引)")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## 2. SQL 使用方法")
    lines.append("")
    lines.append("```sql")
    lines.append("-- 方法 A: JOIN 维度表（推荐，已预计算）")
    lines.append("SELECT b.brand_usage, SUM(p.premium)")
    lines.append("FROM read_parquet('policy/current/*.parquet') p")
    lines.append("JOIN read_parquet('dim/brand/latest.parquet') b ON p.vehicle_model = b.vehicle_model")
    lines.append("GROUP BY b.brand_usage")
    lines.append("")
    lines.append("-- 方法 B: 运行时提取（无维度表时的回退）")
    lines.append("SELECT REGEXP_EXTRACT(vehicle_model, '^([\\u4e00-\\u9fff][\\u4e00-\\u9fff\\-]*)', 1) AS brand")
    lines.append("```")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## 3. 车辆用途分布")
    lines.append("")
    lines.append("| 车辆用途 | 大类 | 保单数 | 保费(万) |")
    lines.append("|:---|:---|---:|---:|")
    for usage, cat, cnt, prem in usage_stats:
        lines.append(f"| {usage} | {cat} | {cnt:,d} | {prem:,d} |")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## 4. 品牌_用途分布（保单≥100）")
    lines.append("")
    lines.append("| 品牌_用途 | 品牌 | 大类 | 保单数 | 保费(万) | 车型数 |")
    lines.append("|:---|:---|:---|---:|---:|---:|")
    for brand_usage, brand, cat, cnt, prem, models in brand_stats:
        lines.append(f"| {brand_usage} | {brand} | {cat} | {cnt:,d} | {prem:,d} | {models} |")

    out_path = KNOWLEDGE_DIR / "BRAND_KNOWLEDGE.md"
    out_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"✅ AI 知识文件: {out_path}")


def _update_summary(total_models, total_combos):
    """更新 dim_summary.json"""
    summary_path = DIM_DIR.parent / "dim_summary.json"
    summary = {}
    if summary_path.exists():
        summary = json.loads(summary_path.read_text())

    summary["brand"] = {
        "total_models": total_models,
        "total_brand_usage_combos": total_combos,
        "composite_key": "brand_usage",
        "generated_at": datetime.now().isoformat(),
        "path": "brand/latest.parquet",
    }
    summary["generated_at"] = datetime.now().isoformat()

    summary_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"✅ 摘要已更新: {summary_path}")


if __name__ == "__main__":
    generate()
