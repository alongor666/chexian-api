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


def _find_src(filename: str) -> Path:
    """源 xlsx 候选路径解析：数据管理/ 根目录优先，已归档的回退到 存量数据/。"""
    for base in (DATA_ROOT, DATA_ROOT / "存量数据"):
        p = base / filename
        if p.exists():
            return p
    return DATA_ROOT / filename  # 都缺失时返回根路径，由 main() 的存在性检查报错


SRC_2025_PLAN = _find_src("2025年分产品保费计划达成情况（0105）.xlsx")
SRC_SALESMAN_LIST = _find_src("川分销售人员名单__3月12日更新.xlsx")
SRC_ORG_DAILY = _find_src("四川分公司机构业务日报（截止2026年3月23日） .xlsx")

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
    # 实体唯一键是 full_name（工号+姓名）：business_no 非唯一——占位工号 000000000
    # 由 13 个「admin×机构直接个代」虚拟业务员共用、200048259 两人共号（刘亚楼/刘婷）。
    # 按 business_no 判重曾误丢 12 个真实实体（BACKLOG 8ee9a0）。
    existing_names = set(master["full_name"])
    extra_from_plans = []
    for _, row in plan_2025.iterrows():
        if row["full_name"] not in existing_names:
            extra_from_plans.append({
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
            existing_names.add(row["full_name"])

    # 补充 2026 JSON 中有、但仍缺的
    for _, row in plan_2026_json.iterrows():
        if row["full_name"] not in existing_names:
            extra_from_plans.append({
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
            existing_names.add(row["full_name"])

    if extra_from_plans:
        master = pd.concat([master, pd.DataFrame(extra_from_plans)], ignore_index=True)

    # 对名单中 team 为空的，从 2026 JSON（mapping）或 2025 计划补充（键同样用 full_name，防共号串档）
    mapping_team = {}
    for _, row in plan_2026_json.iterrows():
        if row["team"]:
            mapping_team[row["full_name"]] = (row["team"], row["organization"])
    for _, row in plan_2025.iterrows():
        if row["team"] and row["full_name"] not in mapping_team:
            mapping_team[row["full_name"]] = (row["team"], row["organization"])

    filled = 0
    for idx, row in master.iterrows():
        if (not row["team"] or pd.isna(row["team"])) and row["full_name"] in mapping_team:
            t, o = mapping_team[row["full_name"]]
            master.at[idx, "team"] = t
            if not row["organization"] or pd.isna(row["organization"]):
                master.at[idx, "organization"] = o
            filled += 1

    # 对 2025 表中有入职时间、但名单中没有的，补充 hire_date
    hire_from_2025 = {r["full_name"]: r["hire_date"] for _, r in plan_2025.iterrows() if r["hire_date"]}
    hire_filled = 0
    for idx, row in master.iterrows():
        if (not row["hire_date"] or pd.isna(row["hire_date"])) and row["full_name"] in hire_from_2025:
            master.at[idx, "hire_date"] = hire_from_2025[row["full_name"]]
            hire_filled += 1

    # 整行重复去重：源名单曾出现「210012051徐小满」两行（仅 tenure_months 不同），
    # 按 full_name 保留 tenure_months 最大的一行（BACKLOG 8ee9a0 缺陷 2）
    before_dedup = len(master)
    master = (
        master.sort_values(["full_name", "tenure_months"], ascending=[True, False])
        .drop_duplicates(subset=["full_name"], keep="first")
    )
    dedup_dropped = before_dedup - len(master)

    master = master.sort_values("full_name").reset_index(drop=True)

    print(f"  总业务员数: {len(master)}")
    print(f"  来源: 名单 {len(salesman_list)}, 计划表补充 {len(extra_from_plans)}, 重复去除 {dedup_dropped}")
    print(f"  团队补填: {filled}, 入职日期补填: {hire_filled}")
    print(f"  状态: 在职 {(master['status']=='在职').sum()}, 离职 {(master['status']=='离职').sum()}, 未知 {(master['status']=='未知').sum()}")

    return master


# ── 6. 输出 Parquet ─────────────────────────────────────────
def write_parquet(df: pd.DataFrame, path: Path, description: str):
    # 统一 L1 metadata 写出
    import sys as _sys
    _pipelines = str(Path(__file__).resolve().parent.parent.parent / "pipelines")
    if _pipelines not in _sys.path:
        _sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
    from pipelines.parquet_utils import write_parquet_with_metadata
    write_parquet_with_metadata(
        df, path,
        processing_mode=f"dim_{description}",
    )
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

    # 实体键去重护栏（BACKLOG 8ee9a0）：salesman 级按 (plan_year, full_name)、
    # organization 级按 (plan_year, organization)。注意不能按 business_no 判重（非唯一）。
    before_plan_dedup = len(plan_all)
    is_salesman_level = plan_all["level"] == "salesman"
    plan_all = pd.concat([
        plan_all[is_salesman_level].drop_duplicates(subset=["plan_year", "full_name"], keep="first"),
        plan_all[~is_salesman_level].drop_duplicates(subset=["plan_year", "organization"], keep="first"),
    ], ignore_index=True)
    plan_dedup_dropped = before_plan_dedup - len(plan_all)

    plan_all = plan_all.sort_values(["plan_year", "level", "organization", "team", "full_name"]).reset_index(drop=True)

    # 写出前快速失败校验：实体键仍有重复说明上面的去重逻辑被改坏，阻断写出
    dup_salesman = salesman_master.duplicated(subset=["full_name"]).sum()
    sales_rows = plan_all[plan_all["level"] == "salesman"]
    org_rows = plan_all[plan_all["level"] != "salesman"]
    dup_plan = (
        sales_rows.duplicated(subset=["plan_year", "full_name"]).sum()
        + org_rows.duplicated(subset=["plan_year", "organization"]).sum()
    )
    if dup_salesman or dup_plan:
        print(f"❌ 去重后仍有重复行（salesman={dup_salesman}, plan={dup_plan}），终止写出")
        sys.exit(1)

    print(f"\n{'='*60}")
    print("计划数据汇总")
    print(f"  2025 业务员级: {len(plan_2025)} 行")
    print(f"  2026 业务员级: {len(plan_2026_json)} 行")
    print(f"  2026 机构级: {len(org_plan_2026)} 行")
    print(f"  重复去除: {plan_dedup_dropped} 行")
    print(f"  总计: {len(plan_all)} 行")

    # 输出 Parquet
    write_parquet(salesman_master, OUT_SALESMAN, "业务员主数据")
    write_parquet(plan_all, OUT_PLAN, "计划数据")

    # 输出摘要 JSON（供其他脚本读取）。读取-合并-写回：
    # 保留其他生成器写入的键（如 brand 区块），只更新本脚本负责的部分。
    summary_path = SCRIPT_DIR / "dim_summary.json"
    summary = {}
    if summary_path.exists():
        try:
            with open(summary_path, "r", encoding="utf-8") as f:
                summary = json.load(f)
        except (json.JSONDecodeError, OSError):
            summary = {}
    summary.update({
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
    })
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"\n  ✅ 摘要: {summary_path.name}")

    # 品牌维度表来自 06_厂牌明细 Excel，经 daily.mjs brand / convert_brand_dim.py 生成。
    # 旧的“从保单厂牌车型字符串抽取品牌_用途”生成器会产出过期 schema，不能再覆盖 latest.parquet。
    print(f"\n{'='*60}")
    print("品牌维度表")
    print("  ⏭️  跳过：请使用 `node 数据管理/daily.mjs brand` 刷新 warehouse/dim/brand/latest.parquet")

    # 更新 data-sources.json
    try:
        from pipelines.data_sources_updater import update_data_sources
        update_data_sources('salesman', row_count=len(salesman_master), field_count=len(salesman_master.columns))
        update_data_sources('plan', row_count=len(plan_all), field_count=len(plan_all.columns))
    except Exception as e:
        print(f"  ⚠️ data-sources.json 更新跳过: {e}")

    print(f"\n{'='*60}")
    print("✅ 维度表生成完成")
    print("=" * 60)


if __name__ == "__main__":
    main()
