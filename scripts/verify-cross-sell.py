#!/usr/bin/env python3
"""
驾乘推介率源数据验证脚本

用途：DuckDB 直查 Parquet 源数据，与 API 返回对比，验证口径一致性。
执行：python3 scripts/verify-cross-sell.py --date 2026-03-26
"""

import argparse
import json
import os
import subprocess
import sys

try:
    import duckdb
except ImportError:
    print("ERROR: 需要安装 duckdb: pip3 install duckdb", file=sys.stderr)
    sys.exit(1)


def query_parquet(date: str) -> dict:
    """直查 Parquet 源数据"""
    con = duckdb.connect()

    # 优先查 daily 分区，回退 current
    daily_path = f"数据管理/warehouse/fact/policy/daily/{date}.parquet"
    current_path = "数据管理/warehouse/fact/policy/current/"

    if os.path.exists(daily_path):
        path = daily_path
        date_filter = ""
    else:
        parquets = [f for f in os.listdir(current_path) if f.endswith(".parquet")]
        if not parquets:
            print(f"ERROR: 找不到 {date} 的 Parquet 文件", file=sys.stderr)
            sys.exit(1)
        path = os.path.join(current_path, parquets[0])
        date_filter = f'AND CAST("签单日期" AS DATE) = \'{date}\''

    passenger_filter = """\"客户类别\" IN ('非营业个人客车', '非营业企业客车', '非营业机关客车')"""

    # 按险别组合分组
    rows = con.execute(f"""
        SELECT
            "险别组合" as coverage,
            COUNT(DISTINCT COALESCE(NULLIF(TRIM("车架号"), ''), "保单号")) as auto_count,
            COUNT(DISTINCT CASE WHEN "交叉销售标识" = true
                  THEN COALESCE(NULLIF(TRIM("车架号"), ''), "保单号") END) as driver_count
        FROM '{path}'
        WHERE {passenger_filter} {date_filter}
        GROUP BY "险别组合"
        ORDER BY "险别组合"
    """).fetchall()

    result = {"date": date, "by_coverage": {}, "total_correct": {}, "total_wrong": {}}
    total_auto = total_driver = 0
    commercial_auto = commercial_driver = 0

    for coverage, auto, driver in rows:
        rate = round(driver * 100.0 / auto, 2) if auto > 0 else 0
        result["by_coverage"][coverage] = {
            "auto_count": auto, "driver_count": driver, "rate": rate
        }
        total_auto += auto
        total_driver += driver
        if coverage in ("主全", "交三"):
            commercial_auto += auto
            commercial_driver += driver

    result["total_correct"] = {
        "auto_count": commercial_auto,
        "driver_count": commercial_driver,
        "rate": round(commercial_driver * 100.0 / commercial_auto, 2) if commercial_auto > 0 else 0,
        "label": "整体(商业险=主全+交三)"
    }
    result["total_wrong"] = {
        "auto_count": total_auto,
        "driver_count": total_driver,
        "rate": round(total_driver * 100.0 / total_auto, 2) if total_auto > 0 else 0,
        "label": "整体(全部险类,含单交)"
    }

    con.close()
    return result


def query_api(date: str, base_url: str = "http://localhost:3000") -> dict | None:
    """查询 API 返回数据"""
    try:
        cmd = ["curl", "-s", f"{base_url}/api/query/cross-sell-summary?vehicleCategory=passenger"]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if proc.returncode != 0:
            return None
        data = json.loads(proc.stdout)
        if not data.get("data"):
            return None
        return data["data"]
    except Exception:
        return None


def compare_and_report(parquet: dict, api_data: dict | None):
    """对比并输出报告"""
    print(f"\n{'='*60}")
    print(f"驾乘推介率源数据验证 — {parquet['date']}")
    print(f"{'='*60}")

    print(f"\n{'险别组合':<12} {'车险件数':>8} {'驾乘件数':>8} {'推介率%':>8}")
    print("-" * 40)
    for cov, d in parquet["by_coverage"].items():
        marker = " ← 排除" if cov == "单交" else ""
        print(f"{cov:<12} {d['auto_count']:>8} {d['driver_count']:>8} {d['rate']:>8}{marker}")

    correct = parquet["total_correct"]
    wrong = parquet["total_wrong"]
    print("-" * 40)
    print(f"{'正确整体':<12} {correct['auto_count']:>8} {correct['driver_count']:>8} {correct['rate']:>8}")
    print(f"{'错误整体':<12} {wrong['auto_count']:>8} {wrong['driver_count']:>8} {wrong['rate']:>8}")

    has_diff = False
    if api_data:
        print(f"\n--- API 对比 ---")
        for row in api_data.get("rows", []):
            if row.get("coverage_combination") == "整体":
                api_auto = row.get("day_auto_count", 0)
                api_driver = row.get("day_driver_count", 0)
                api_rate = row.get("day_rate", 0)
                print(f"API 整体行:  auto={api_auto}, driver={api_driver}, rate={api_rate}%")
                print(f"源数据正确:  auto={correct['auto_count']}, driver={correct['driver_count']}, rate={correct['rate']}%")
                if api_auto != correct["auto_count"] or api_driver != correct["driver_count"]:
                    print(f"⚠️  差异! auto差{api_auto - correct['auto_count']}, driver差{api_driver - correct['driver_count']}")
                    has_diff = True
                else:
                    print("✅ 一致")
    else:
        print(f"\n⚠️  API 未响应（服务未运行？），仅输出源数据结果")

    return has_diff


def main():
    parser = argparse.ArgumentParser(description="驾乘推介率源数据验证")
    parser.add_argument("--date", required=True, help="验证日期 (YYYY-MM-DD)")
    parser.add_argument("--api", default="http://localhost:3000", help="API 地址")
    args = parser.parse_args()

    parquet = query_parquet(args.date)
    api_data = query_api(args.date, args.api)
    has_diff = compare_and_report(parquet, api_data)

    sys.exit(1 if has_diff else 0)


if __name__ == "__main__":
    main()
