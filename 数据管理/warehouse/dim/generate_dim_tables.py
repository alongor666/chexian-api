#!/usr/bin/env python3
"""
维度表 Parquet 生成脚本 v1.0

从三个 Excel 源文件提取、合并、输出标准化的维度表：
  1. salesman/latest.parquet — 业务员主数据（编号、姓名、团队、机构、入职、离职、状态）
  2. plan/latest.parquet     — 计划数据（2025 + 2026，业务员级 + 机构级）

源文件：
  - 2025年分产品保费计划达成情况（0105）.xlsx  → 2025 业务员计划 + 实际 + 入职时间
  - 2026年销售人员分产品保费计划.xlsx           → 2026 业务员计划（已由 generate_salesman_mapping.py 处理）
  - 川分销售人员名单__3月12日更新.xlsx          → 业务员基础信息（岗位、状态、入职、离职）
  - 四川分公司机构业务日报（截止2026年3月23日）.xlsx → 2026 机构级计划

用法：
  cd 数据管理
  python3 warehouse/dim/generate_dim_tables.py

依赖：pandas, openpyxl, pyarrow
"""

import json
import re
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

# ── 路径配置 ──────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent
DATA_ROOT = SCRIPT_DIR.parent.parent  # 数据管理/
MAPPING_JSON = SCRIPT_DIR / "业务员归属与规划" / "salesman_organization_mapping.json"

SRC_2025_PLAN = DATA_ROOT / "2025年分产品保费计划达成情况（0105）.xlsx"
SRC_SALESMAN_LIST = DATA_ROOT / "川分销售人员名单__3月12日更新.xlsx"
SRC_ORG_DAILY = DATA_ROOT / "四川分公司机构业务日报（截止2026年3月23日） .xlsx"

OUT_SALESMAN = SCRIPT_DIR / "salesman" / "latest.parquet"
OUT_PLAN = SCRIPT_DIR / "plan" / "latest.parquet"


def extract_business_no(full_name: str) -> str:
    """从 '200048468肖照耀' 中提取编号 '200048468'"""
    m = re.match(r"(\d+)", str(full_name).strip())
    return m.group(1) if m else ""


def extract_name(full_name: str) -> str:
    """从 '200048468肖照耀' 中提取姓名 '肖照耀'"""
    return re.sub(r"^\d+", "", str(full_name).strip())


def parse_date(val) -> str | None:
    """尝试解析日期，返回 YYYY-MM-DD 或 None"""
    if val is None or (isinstance(val, str) and val.strip() in ("", "null")):
        return None
    if isinstance(val, datetime):
        return val.strftime("%Y-%m-%d")
    s = str(val).strip().replace("/", "-")
    for fmt in ("%Y-%m-%d", "%Y-%m", "%Y.%m.%d"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


# ── 1. 加载销售人员名单（业务员基础信息） ────────────────────
def load_salesman_list() -> pd.DataFrame:
    print(f"\n{'='*60}")
    print(f"加载销售人员名单: {SRC_SALESMAN_LIST.name}")

    df = pd.read_excel(SRC_SALESMAN_LIST, sheet_name="销售人员名单")
    print(f"  行数: {len(df)}")

    records = []
    for _, row in df.iterrows():
        full_name = str(row.get("业务员", "") or "").strip()
        if not full_name or "汇总" in full_name:
            continue
        records.append({
            "business_no": extract_business_no(full_name),
            "salesman_name": extract_name(full_name),
            "full_name": full_name,
            "position": str(row.get("岗位", "") or "").strip() or None,
            "team": str(row.get("销售团队", "") or "").strip() or None,
            "organization": str(row.get("三级机构", "") or "").strip() or None,
            "hire_date": parse_date(row.get("入司年月")),
            "status": str(row.get("在职状态", "") or "").strip() or "未知",
            "leave_date": parse_date(row.get("离职月")),
            "tenure_months": int(row.get("在职月数", 0) or 0),
        })

    result = pd.DataFrame(records)
    print(f"  有效业务员: {len(result)}")
    print(f"  在职: {(result['status'] == '在职').sum()}, 离职: {(result['status'] == '离职').sum()}")
    return result


# ── 2. 加载 2025 年计划数据 ──────────────────────────────────
def load_2025_plan() -> pd.DataFrame:
    print(f"\n{'='*60}")
    print(f"加载 2025 年计划: {SRC_2025_PLAN.name}")

    df_raw = pd.read_excel(SRC_2025_PLAN, header=None, sheet_name="25年分产品达成情况")
    # Row 0: 主表头, Row 1: 子表头（车/财/人/合计）, Row 2+: 数据
    data = df_raw.iloc[2:].reset_index(drop=True)

    records = []
    current_org = None
    current_team = None
    for _, row in data.iterrows():
        # 前向填充机构和团队
        if pd.notna(row[0]):
            current_org = str(row[0]).strip()
        if pd.notna(row[1]):
            current_team = str(row[1]).strip()

        full_name = str(row[2]).strip() if pd.notna(row[2]) else ""
        if not full_name or "汇总" in full_name:
            continue

        hire_date = parse_date(row[3])

        def safe_float(val):
            try:
                v = float(val)
                return v if pd.notna(v) else 0.0
            except (ValueError, TypeError):
                return 0.0

        records.append({
            "plan_year": 2025,
            "level": "salesman",
            "business_no": extract_business_no(full_name),
            "salesman_name": extract_name(full_name),
            "full_name": full_name,
            "team": current_team,
            "organization": current_org,
            "hire_date": hire_date,
            "plan_vehicle": safe_float(row[5]),    # 车险计划
            "plan_property": safe_float(row[6]),   # 财产险计划
            "plan_personal": safe_float(row[7]),   # 人身险计划
            "plan_total": safe_float(row[8]),      # 合计计划
            "actual_vehicle": safe_float(row[9]),  # 车险实际
            "actual_property": safe_float(row[10]),
            "actual_personal": safe_float(row[11]),
            "actual_total": safe_float(row[12]),
        })

    result = pd.DataFrame(records)
    print(f"  有效业务员计划: {len(result)}")
    print(f"  车险计划总额: {result['plan_vehicle'].sum():.0f} 万")
    return result


# ── 3. 加载 2026 年业务员计划（从现有 JSON） ─────────────────
def load_2026_plan_from_mapping() -> pd.DataFrame:
    print(f"\n{'='*60}")
    print(f"加载 2026 年计划: {MAPPING_JSON.name}")

    with open(MAPPING_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)

    records = []
    for item in data["salesman_mapping"]:
        plan_val = item.get("car_insurance_plan_2026", 0) or 0
        records.append({
            "plan_year": 2026,
            "level": "salesman",
            "business_no": item.get("business_no", ""),
            "salesman_name": item.get("salesman_name", ""),
            "full_name": item.get("full_name", ""),
            "team": item.get("team", ""),
            "organization": item.get("organization", ""),
            "hire_date": None,
            "plan_vehicle": float(plan_val),
            "plan_property": 0.0,   # 2026 JSON 中只有车险计划
            "plan_personal": 0.0,
            "plan_total": float(plan_val),  # 暂以车险代替
            "actual_vehicle": 0.0,
            "actual_property": 0.0,
            "actual_personal": 0.0,
            "actual_total": 0.0,
        })

    result = pd.DataFrame(records)
    print(f"  有效业务员计划: {len(result)}")
    print(f"  车险计划总额: {result['plan_vehicle'].sum():.0f} 万")
    return result


# ── 4. 加载 2026 年机构级计划 ────────────────────────────────
def load_2026_org_plan() -> pd.DataFrame:
    print(f"\n{'='*60}")
    print(f"加载 2026 年机构级计划: {SRC_ORG_DAILY.name}")

    df_raw = pd.read_excel(SRC_ORG_DAILY, header=None, sheet_name="分公司机构业务日报")
    # Row 0: 标题, Row 1: 统计时间, Row 2-4: 表头, Row 5: 空行, Row 6+: 数据
    # 列0=机构, 列1=险种, 列2=26年保费计划

    INSURANCE_MAP = {"车险": "vehicle", "财产险": "property", "人身险": "personal", "合计": "total"}

    records = []
    current_org = None
    org_plans = {}

    for idx in range(6, df_raw.shape[0]):
        row = df_raw.iloc[idx]
        org_val = str(row[0]).strip() if pd.notna(row[0]) else ""
        ins_type = str(row[1]).strip() if pd.notna(row[1]) else ""
        plan_val = row[2]

        if org_val:
            # 新机构开始前，保存上一个机构
            if current_org and current_org != "分公司合计" and org_plans:
                records.append({
                    "plan_year": 2026,
                    "level": "organization",
                    "business_no": "",
                    "salesman_name": "",
                    "full_name": "",
                    "team": "",
                    "organization": current_org,
                    "hire_date": None,
                    "plan_vehicle": org_plans.get("vehicle", 0.0),
                    "plan_property": org_plans.get("property", 0.0),
                    "plan_personal": org_plans.get("personal", 0.0),
                    "plan_total": org_plans.get("total", 0.0),
                    "actual_vehicle": 0.0,
                    "actual_property": 0.0,
                    "actual_personal": 0.0,
                    "actual_total": 0.0,
                })
            current_org = org_val
            org_plans = {}

        key = INSURANCE_MAP.get(ins_type)
        if key and pd.notna(plan_val):
            try:
                org_plans[key] = float(plan_val)
            except (ValueError, TypeError):
                pass

    # 最后一个机构
    if current_org and current_org != "分公司合计" and org_plans:
        records.append({
            "plan_year": 2026,
            "level": "organization",
            "business_no": "",
            "salesman_name": "",
            "full_name": "",
            "team": "",
            "organization": current_org,
            "hire_date": None,
            "plan_vehicle": org_plans.get("vehicle", 0.0),
            "plan_property": org_plans.get("property", 0.0),
            "plan_personal": org_plans.get("personal", 0.0),
            "plan_total": org_plans.get("total", 0.0),
            "actual_vehicle": 0.0,
            "actual_property": 0.0,
            "actual_personal": 0.0,
            "actual_total": 0.0,
        })

    result = pd.DataFrame(records)
    print(f"  机构数: {len(result)}")
    for _, r in result.iterrows():
        print(f"    {r['organization']}: 车险 {r['plan_vehicle']:.0f} / 财险 {r['plan_property']:.0f} / 人身 {r['plan_personal']:.0f} / 合计 {r['plan_total']:.0f}")
    return result


# ── 5. 合成业务员主数据（salesman/latest.parquet） ───────────
def build_salesman_table(
    salesman_list: pd.DataFrame,
    plan_2025: pd.DataFrame,
    plan_2026_json: pd.DataFrame,
) -> pd.DataFrame:
    print(f"\n{'='*60}")
    print("合成业务员主数据表")

    # 以销售人员名单为主表（最新、最全）
    master = salesman_list[["business_no", "salesman_name", "full_name",
                            "position", "team", "organization",
                            "hire_date", "status", "leave_date", "tenure_months"]].copy()

    # 补充 2025 计划中有、但名单中没有的业务员
    existing_nos = set(master["business_no"])
    extra_from_2025 = []
    for _, row in plan_2025.iterrows():
        if row["business_no"] not in existing_nos:
            extra_from_2025.append({
                "business_no": row["business_no"],
                "salesman_name": row["salesman_name"],
                "full_name": row["full_name"],
                "position": None,
                "team": row["team"],
                "organization": row["organization"],
                "hire_date": row["hire_date"],
                "status": "未知",
                "leave_date": None,
                "tenure_months": 0,
            })
            existing_nos.add(row["business_no"])

    # 补充 2026 JSON 中有、但仍缺的
    for _, row in plan_2026_json.iterrows():
        if row["business_no"] not in existing_nos:
            extra_from_2025.append({
                "business_no": row["business_no"],
                "salesman_name": row["salesman_name"],
                "full_name": row["full_name"],
                "position": None,
                "team": row["team"],
                "organization": row["organization"],
                "hire_date": None,
                "status": "未知",
                "leave_date": None,
                "tenure_months": 0,
            })
            existing_nos.add(row["business_no"])

    if extra_from_2025:
        master = pd.concat([master, pd.DataFrame(extra_from_2025)], ignore_index=True)

    # 对名单中 team 为空的，从 2026 JSON（mapping）或 2025 计划补充
    mapping_team = {}
    for _, row in plan_2026_json.iterrows():
        if row["team"]:
            mapping_team[row["business_no"]] = (row["team"], row["organization"])
    for _, row in plan_2025.iterrows():
        if row["team"] and row["business_no"] not in mapping_team:
            mapping_team[row["business_no"]] = (row["team"], row["organization"])

    filled = 0
    for idx, row in master.iterrows():
        if (not row["team"] or pd.isna(row["team"])) and row["business_no"] in mapping_team:
            t, o = mapping_team[row["business_no"]]
            master.at[idx, "team"] = t
            if not row["organization"] or pd.isna(row["organization"]):
                master.at[idx, "organization"] = o
            filled += 1

    # 对 2025 表中有入职时间、但名单中没有的，补充 hire_date
    hire_from_2025 = {r["business_no"]: r["hire_date"] for _, r in plan_2025.iterrows() if r["hire_date"]}
    hire_filled = 0
    for idx, row in master.iterrows():
        if (not row["hire_date"] or pd.isna(row["hire_date"])) and row["business_no"] in hire_from_2025:
            master.at[idx, "hire_date"] = hire_from_2025[row["business_no"]]
            hire_filled += 1

    master = master.sort_values("full_name").reset_index(drop=True)

    print(f"  总业务员数: {len(master)}")
    print(f"  来源: 名单 {len(salesman_list)}, 2025补充 {len(extra_from_2025)}")
    print(f"  团队补填: {filled}, 入职日期补填: {hire_filled}")
    print(f"  状态: 在职 {(master['status']=='在职').sum()}, 离职 {(master['status']=='离职').sum()}, 未知 {(master['status']=='未知').sum()}")

    return master


# ── 6. 输出 Parquet ─────────────────────────────────────────
def write_parquet(df: pd.DataFrame, path: Path, description: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    table = pa.Table.from_pandas(df, preserve_index=False)
    pq.write_table(table, str(path), compression="snappy")
    size_kb = path.stat().st_size / 1024
    print(f"\n  ✅ {description}: {path.name} ({len(df)} 行, {size_kb:.1f} KB)")
    print(f"     → {path}")


# ── 主流程 ──────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("维度表 Parquet 生成脚本 v1.0")
    print(f"时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    # 检查源文件
    for f, label in [
        (SRC_2025_PLAN, "2025年计划"),
        (SRC_SALESMAN_LIST, "销售人员名单"),
        (SRC_ORG_DAILY, "机构业务日报"),
        (MAPPING_JSON, "业务员映射JSON"),
    ]:
        if not f.exists():
            print(f"❌ 缺少源文件 [{label}]: {f}")
            sys.exit(1)
        print(f"  ✓ {label}: {f.name}")

    # 加载数据
    salesman_list = load_salesman_list()
    plan_2025 = load_2025_plan()
    plan_2026_json = load_2026_plan_from_mapping()
    org_plan_2026 = load_2026_org_plan()

    # 合成业务员主数据
    salesman_master = build_salesman_table(salesman_list, plan_2025, plan_2026_json)

    # 合并计划数据（2025 业务员 + 2026 业务员 + 2026 机构）
    plan_all = pd.concat([plan_2025, plan_2026_json, org_plan_2026], ignore_index=True)
    plan_all = plan_all.sort_values(["plan_year", "level", "organization", "team", "full_name"]).reset_index(drop=True)

    print(f"\n{'='*60}")
    print("计划数据汇总")
    print(f"  2025 业务员级: {len(plan_2025)} 行")
    print(f"  2026 业务员级: {len(plan_2026_json)} 行")
    print(f"  2026 机构级: {len(org_plan_2026)} 行")
    print(f"  总计: {len(plan_all)} 行")

    # 输出 Parquet
    write_parquet(salesman_master, OUT_SALESMAN, "业务员主数据")
    write_parquet(plan_all, OUT_PLAN, "计划数据")

    # 输出摘要 JSON（供其他脚本读取）
    summary = {
        "generated_at": datetime.now().isoformat(),
        "salesman": {
            "total": len(salesman_master),
            "active": int((salesman_master["status"] == "在职").sum()),
            "resigned": int((salesman_master["status"] == "离职").sum()),
            "unknown": int((salesman_master["status"] == "未知").sum()),
            "path": str(OUT_SALESMAN.relative_to(SCRIPT_DIR)),
        },
        "plan": {
            "total_rows": len(plan_all),
            "years": sorted(plan_all["plan_year"].unique().tolist()),
            "levels": sorted(plan_all["level"].unique().tolist()),
            "plan_2025_vehicle_total": float(plan_2025["plan_vehicle"].sum()),
            "plan_2026_vehicle_total": float(plan_2026_json["plan_vehicle"].sum()),
            "plan_2026_org_vehicle_total": float(org_plan_2026["plan_vehicle"].sum()),
            "path": str(OUT_PLAN.relative_to(SCRIPT_DIR)),
        },
    }
    summary_path = SCRIPT_DIR / "dim_summary.json"
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(f"\n  ✅ 摘要: {summary_path.name}")

    # 品牌维度表（从 Parquet 保单数据提取，不依赖 Excel）
    print(f"\n{'='*60}")
    print("品牌维度表")
    try:
        from brand.generate_brand_dim import generate as generate_brand
        generate_brand()
    except Exception as e:
        print(f"  ⚠️ 品牌维度表生成失败: {e}")

    print(f"\n{'='*60}")
    print("✅ 维度表生成完成")
    print("=" * 60)


if __name__ == "__main__":
    main()
