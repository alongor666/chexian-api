#!/usr/bin/env python3
"""
数据巡检引擎 (Patrol Engine) — 通用域巡检框架

从 JSON 配置读取数据源、维度、指标、阈值，自动执行：
  1. 单维度分组分析 + 四级亮灯
  2. 2-维交叉盲点发现（偏离整体 >阈值）
  3. 环比变化检测（按配置的时间维度）
  4. 输出结构化 JSON

用法:
  python3 patrol_engine.py --domain renewal
  python3 patrol_engine.py --domain renewal --dry-run
  python3 patrol_engine.py --config path/to/config.json
"""

import argparse
import json
import sys
import time
from datetime import datetime
from itertools import combinations
from pathlib import Path

try:
    import duckdb
except ImportError:
    print("错误: pip3 install duckdb")
    sys.exit(2)

# ── 路径 ──
SCRIPT_DIR = Path(__file__).resolve().parent
DATA_ROOT = SCRIPT_DIR.parent  # 数据管理/
PROJECT_ROOT = DATA_ROOT.parent
CONFIG_DIR = SCRIPT_DIR / "domain_configs"
DEFAULT_OUTPUT_ROOT = DATA_ROOT / "patrol_reports"


# ── 亮灯判定 ──
ALERT_LEVELS = {
    "red": {"label": "严重", "emoji": "🔴", "priority": 0},
    "orange": {"label": "预警", "emoji": "🟠", "priority": 1},
    "yellow": {"label": "关注", "emoji": "🟡", "priority": 2},
    "green": {"label": "正常", "emoji": "🟢", "priority": 3},
}


def classify_alert(value, thresholds, direction):
    """四级亮灯判定。thresholds 为 None 时返回 green。"""
    if thresholds is None or value is None:
        return "green"

    red = thresholds.get("red")
    orange = thresholds.get("orange")
    yellow = thresholds.get("yellow")

    if direction == "higher_is_better":
        if red is not None and value < red:
            return "red"
        if orange is not None and value < orange:
            return "orange"
        if yellow is not None and value < yellow:
            return "yellow"
        return "green"
    elif direction == "lower_is_better":
        if red is not None and value > red:
            return "red"
        if orange is not None and value > orange:
            return "orange"
        if yellow is not None and value > yellow:
            return "yellow"
        return "green"
    return "green"


def format_value(value, fmt):
    """格式化指标值用于展示。"""
    if value is None:
        return "N/A"
    if fmt == "percent":
        return f"{value * 100:.1f}%"
    if fmt == "integer":
        return f"{int(value):,}"
    if fmt == "number":
        return f"{value:,.2f}"
    return str(value)


# ── 引擎核心 ──

class PatrolEngine:
    """通用数据巡检引擎。"""

    def __init__(self, config: dict, dry_run: bool = False):
        self.config = config
        self.dry_run = dry_run
        self.domain = config["domain"]
        self.display_name = config.get("display_name", self.domain)
        self.data_source = str(DATA_ROOT / config["data_source"])
        self.base_filter = config.get("base_filter")
        self.dimensions = config["dimensions"]
        self.metrics = config["metrics"]
        self.cross_config = config.get("cross_analysis", {})
        self.comparison_config = config.get("comparison", {})
        self.con = None
        self.results = {
            "domain": self.domain,
            "display_name": self.display_name,
            "generated_at": datetime.now().isoformat(),
            "data_source": config["data_source"],
            "summary": {},
            "overall": {},
            "sections": [],
            "blindspots": [],
            "comparisons": [],
            "alerts": {"red": 0, "orange": 0, "yellow": 0, "green": 0},
        }

    def run(self):
        """执行完整巡检流程。"""
        t0 = time.time()
        self.con = duckdb.connect()

        # 验证数据源
        if not self._verify_data_source():
            return self.results

        # 整体指标
        self._compute_overall()

        # 单维度分组分析
        for dim in self.dimensions:
            self._patrol_dimension(dim)

        # 2-维交叉盲点
        if self.cross_config.get("enabled"):
            self._discover_blindspots()

        # 环比变化检测
        if self.comparison_config.get("enabled"):
            self._detect_changes()

        # 汇总（保留 _verify_data_source 已写入的 total_records）
        elapsed = round(time.time() - t0, 1)
        self.results["summary"].update({
            "total_alerts": sum(
                self.results["alerts"][k] for k in ["red", "orange", "yellow"]
            ),
            "red_count": self.results["alerts"]["red"],
            "orange_count": self.results["alerts"]["orange"],
            "yellow_count": self.results["alerts"]["yellow"],
            "green_count": self.results["alerts"]["green"],
            "dimensions_checked": len(self.dimensions),
            "blindspots_found": len(self.results["blindspots"]),
            "comparisons_checked": len(self.results["comparisons"]),
            "elapsed_seconds": elapsed,
        })

        self.con.close()
        return self.results

    def _where_clause(self):
        """基础过滤条件。"""
        return f"WHERE {self.base_filter}" if self.base_filter else ""

    def _verify_data_source(self):
        """验证数据源可访问且有数据。"""
        sql = f"SELECT COUNT(*) FROM read_parquet('{self.data_source}')"
        if self.dry_run:
            print(f"[DRY-RUN] {sql}")
            return True
        try:
            count = self.con.execute(sql).fetchone()[0]
            self.results["summary"]["total_records"] = count
            if count == 0:
                print(f"⚠️ 数据源为空: {self.data_source}")
                return False
            print(f"✓ 数据源验证通过: {count:,} 条记录")
            return True
        except Exception as e:
            print(f"✗ 数据源不可用: {e}")
            self.results["summary"]["error"] = str(e)
            return False

    def _compute_overall(self):
        """计算整体指标（不分组）。"""
        metric_sqls = [f"{m['sql']} AS {m['id']}" for m in self.metrics]
        sql = f"""
            SELECT {', '.join(metric_sqls)}
            FROM read_parquet('{self.data_source}')
            {self._where_clause()}
        """
        if self.dry_run:
            print(f"[DRY-RUN] overall:\n{sql}")
            return

        row = self.con.execute(sql).fetchone()
        cols = [m["id"] for m in self.metrics]
        overall = {}
        for i, m in enumerate(self.metrics):
            val = float(row[i]) if row[i] is not None else None
            alert = classify_alert(val, m.get("thresholds"), m.get("direction", "neutral"))
            overall[m["id"]] = {
                "value": val,
                "display": format_value(val, m.get("format", "number")),
                "alert": alert,
                "display_name": m["display_name"],
            }
        self.results["overall"] = overall

    def _patrol_dimension(self, dim: dict):
        """对单个维度执行分组巡检。"""
        dim_id = dim["id"]
        dim_col = dim["sql_column"]
        min_sample = dim.get("min_sample", 30)

        metric_sqls = [f"{m['sql']} AS {m['id']}" for m in self.metrics]
        sql = f"""
            SELECT
                {dim_col} AS dim_value,
                COUNT(*) AS sample_size,
                {', '.join(metric_sqls)}
            FROM read_parquet('{self.data_source}')
            {self._where_clause()}
            GROUP BY {dim_col}
            HAVING COUNT(*) >= {min_sample}
            ORDER BY {dim_col}
        """
        if self.dry_run:
            print(f"[DRY-RUN] dimension={dim_id}:\n{sql}")
            return

        result = self.con.execute(sql)
        desc = result.description
        col_names = [d[0] for d in desc]
        rows = result.fetchall()

        findings = []
        for row in rows:
            dim_value = str(row[0]) if row[0] is not None else "(空)"
            sample_size = int(row[1])
            metric_results = {}
            worst_alert = "green"

            for i, m in enumerate(self.metrics):
                col_idx = col_names.index(m["id"])
                val = float(row[col_idx]) if row[col_idx] is not None else None
                alert = classify_alert(val, m.get("thresholds"), m.get("direction", "neutral"))
                metric_results[m["id"]] = {
                    "value": val,
                    "display": format_value(val, m.get("format", "number")),
                    "alert": alert,
                    "display_name": m["display_name"],
                }
                if ALERT_LEVELS[alert]["priority"] < ALERT_LEVELS[worst_alert]["priority"]:
                    worst_alert = alert

            self.results["alerts"][worst_alert] += 1
            findings.append({
                "dim_value": dim_value,
                "sample_size": sample_size,
                "metrics": metric_results,
                "worst_alert": worst_alert,
            })

        # 按严重程度排序（红→橙→黄→绿）
        findings.sort(key=lambda f: ALERT_LEVELS[f["worst_alert"]]["priority"])

        section = {
            "dimension_id": dim_id,
            "dimension_name": dim.get("display_name", dim_id),
            "group_count": len(findings),
            "findings": findings,
        }
        self.results["sections"].append(section)

    def _discover_blindspots(self):
        """2-维交叉盲点发现：找到偏离整体显著的组合。"""
        deviation_threshold = self.cross_config.get("deviation_threshold", 0.20)
        min_sample = self.cross_config.get("min_sample", 20)
        max_dims = self.cross_config.get("max_dimensions", 2)

        # 只用可交叉的维度（排除 expiry_month 等时间维度）
        crossable = [d for d in self.dimensions if d["id"] != "expiry_month"]

        # 取第一个 rate 类指标做交叉分析
        rate_metrics = [m for m in self.metrics if m.get("format") == "percent"]
        if not rate_metrics:
            return
        target = rate_metrics[0]

        overall_val = self.results["overall"].get(target["id"], {}).get("value")
        if overall_val is None or overall_val == 0:
            return

        for dim_a, dim_b in combinations(crossable, max_dims):
            sql = f"""
                SELECT
                    {dim_a['sql_column']} AS dim_a,
                    {dim_b['sql_column']} AS dim_b,
                    COUNT(*) AS sample_size,
                    {target['sql']} AS metric_value
                FROM read_parquet('{self.data_source}')
                {self._where_clause()}
                GROUP BY {dim_a['sql_column']}, {dim_b['sql_column']}
                HAVING COUNT(*) >= {min_sample}
            """
            if self.dry_run:
                print(f"[DRY-RUN] cross {dim_a['id']}×{dim_b['id']}:\n{sql}")
                continue

            rows = self.con.execute(sql).fetchall()
            for row in rows:
                val_a, val_b, sample, metric_val = row[0], row[1], int(row[2]), row[3]
                if metric_val is None:
                    continue
                metric_val = float(metric_val)
                deviation = (metric_val - overall_val) / overall_val if overall_val != 0 else 0

                if abs(deviation) >= deviation_threshold:
                    self.results["blindspots"].append({
                        "dimensions": [
                            {"id": dim_a["id"], "name": dim_a.get("display_name", dim_a["id"]), "value": str(val_a) if val_a else "(空)"},
                            {"id": dim_b["id"], "name": dim_b.get("display_name", dim_b["id"]), "value": str(val_b) if val_b else "(空)"},
                        ],
                        "metric_id": target["id"],
                        "metric_name": target["display_name"],
                        "metric_value": metric_val,
                        "metric_display": format_value(metric_val, target.get("format")),
                        "overall_value": overall_val,
                        "overall_display": format_value(overall_val, target.get("format")),
                        "deviation": round(deviation, 4),
                        "deviation_display": f"{deviation:+.1%}",
                        "sample_size": sample,
                        "alert": classify_alert(metric_val, target.get("thresholds"), target.get("direction", "neutral")),
                        "direction": "above" if deviation > 0 else "below",
                    })

        # 按偏离绝对值排序
        self.results["blindspots"].sort(key=lambda b: abs(b["deviation"]), reverse=True)

    def _detect_changes(self):
        """环比变化检测：按时间维度分组，比较相邻期间。"""
        time_dim_id = self.comparison_config.get("dimension", "expiry_month")
        time_dim = next((d for d in self.dimensions if d["id"] == time_dim_id), None)
        if not time_dim:
            return

        time_col = time_dim["sql_column"]
        rate_metrics = [m for m in self.metrics if m.get("format") == "percent"]
        if not rate_metrics:
            return

        metric_sqls = [f"{m['sql']} AS {m['id']}" for m in rate_metrics]
        sql = f"""
            SELECT
                {time_col} AS period,
                COUNT(*) AS sample_size,
                {', '.join(metric_sqls)}
            FROM read_parquet('{self.data_source}')
            {self._where_clause()}
            GROUP BY {time_col}
            ORDER BY {time_col}
        """
        if self.dry_run:
            print(f"[DRY-RUN] comparison:\n{sql}")
            return

        rows = self.con.execute(sql).fetchall()
        if len(rows) < 2:
            return

        for i in range(1, len(rows)):
            prev_row = rows[i - 1]
            curr_row = rows[i]
            prev_period = prev_row[0]
            curr_period = curr_row[0]
            prev_size = int(prev_row[1])
            curr_size = int(curr_row[1])

            changes = []
            for j, m in enumerate(rate_metrics):
                prev_val = float(prev_row[j + 2]) if prev_row[j + 2] is not None else None
                curr_val = float(curr_row[j + 2]) if curr_row[j + 2] is not None else None
                if prev_val is None or curr_val is None or prev_val == 0:
                    continue
                change = (curr_val - prev_val) / prev_val
                changes.append({
                    "metric_id": m["id"],
                    "metric_name": m["display_name"],
                    "prev_value": prev_val,
                    "curr_value": curr_val,
                    "prev_display": format_value(prev_val, m.get("format")),
                    "curr_display": format_value(curr_val, m.get("format")),
                    "change": round(change, 4),
                    "change_display": f"{change:+.1%}",
                    "significant": abs(change) >= 0.10,
                })

            self.results["comparisons"].append({
                "prev_period": str(prev_period),
                "curr_period": str(curr_period),
                "prev_sample": prev_size,
                "curr_sample": curr_size,
                "changes": changes,
            })

    def save(self, output_dir: str = None):
        """保存巡检结果到 JSON。"""
        out_dir = Path(output_dir) if output_dir else DEFAULT_OUTPUT_ROOT / self.domain
        out_dir.mkdir(parents=True, exist_ok=True)

        # latest.json
        latest = out_dir / "latest.json"
        with open(latest, "w", encoding="utf-8") as f:
            json.dump(self.results, f, ensure_ascii=False, indent=2)
        print(f"✓ 巡检报告已保存: {latest}")

        # 历史存档（按日期）
        date_str = datetime.now().strftime("%Y%m%d")
        archive = out_dir / f"{date_str}.json"
        with open(archive, "w", encoding="utf-8") as f:
            json.dump(self.results, f, ensure_ascii=False, indent=2)
        print(f"✓ 历史存档: {archive}")

        return str(latest)


# ── CLI ──

def load_config(domain: str = None, config_path: str = None) -> dict:
    """加载域配置。"""
    if config_path:
        p = Path(config_path)
    elif domain:
        p = CONFIG_DIR / f"{domain}.json"
    else:
        raise ValueError("必须指定 --domain 或 --config")

    if not p.exists():
        print(f"✗ 配置文件不存在: {p}")
        sys.exit(2)

    with open(p, encoding="utf-8") as f:
        return json.load(f)


def print_summary(results: dict):
    """打印巡检摘要到终端。"""
    s = results.get("summary", {})
    alerts = results.get("alerts", {})
    domain = results.get("display_name", results.get("domain", ""))

    print(f"\n{'='*60}")
    print(f"  {domain} 巡检报告")
    print(f"{'='*60}")
    total = s.get('total_records')
    print(f"  记录数: {total:,}" if total else "  记录数: N/A")
    print(f"  维度: {s.get('dimensions_checked', 0)} 个")
    print(f"  亮灯: 🔴×{alerts.get('red',0)}  🟠×{alerts.get('orange',0)}  🟡×{alerts.get('yellow',0)}  🟢×{alerts.get('green',0)}")
    print(f"  盲点: {s.get('blindspots_found', 0)} 个")
    print(f"  耗时: {s.get('elapsed_seconds', 0)}s")
    print(f"{'='*60}")

    # 整体指标
    overall = results.get("overall", {})
    if overall:
        print("\n  整体指标:")
        for mid, info in overall.items():
            emoji = ALERT_LEVELS[info["alert"]]["emoji"]
            print(f"    {emoji} {info['display_name']}: {info['display']}")

    # 严重警报
    red_findings = []
    for section in results.get("sections", []):
        for f in section.get("findings", []):
            if f["worst_alert"] in ("red", "orange"):
                red_findings.append((section["dimension_name"], f["dim_value"], f["worst_alert"]))
    if red_findings:
        print(f"\n  ⚠️ 需要关注 ({len(red_findings)} 项):")
        for dim_name, dim_val, alert in red_findings[:10]:
            emoji = ALERT_LEVELS[alert]["emoji"]
            print(f"    {emoji} {dim_name}={dim_val}")

    # Top 盲点
    blindspots = results.get("blindspots", [])
    if blindspots:
        print(f"\n  🔍 盲点发现 (Top 5):")
        for bs in blindspots[:5]:
            dims_str = " × ".join(f"{d['name']}={d['value']}" for d in bs["dimensions"])
            print(f"    {dims_str}: {bs['metric_name']}={bs['metric_display']} ({bs['deviation_display']})")

    print()


def main():
    parser = argparse.ArgumentParser(description="数据巡检引擎")
    parser.add_argument("--domain", help="巡检域名 (如 renewal)")
    parser.add_argument("--config", help="自定义配置文件路径")
    parser.add_argument("--dry-run", action="store_true", help="只打印 SQL 不执行")
    parser.add_argument("--output-dir", help="自定义输出目录")
    parser.add_argument("--quiet", action="store_true", help="静默模式，不打印摘要")
    args = parser.parse_args()

    config = load_config(domain=args.domain, config_path=args.config)
    engine = PatrolEngine(config, dry_run=args.dry_run)
    results = engine.run()

    if args.dry_run:
        print("\n[DRY-RUN] 完成，未执行实际查询")
        sys.exit(0)

    if not args.quiet:
        print_summary(results)

    output_path = engine.save(args.output_dir)

    # 退出码：有严重异常返回 1
    red_count = results.get("alerts", {}).get("red", 0)
    sys.exit(1 if red_count > 0 else 0)


if __name__ == "__main__":
    main()
