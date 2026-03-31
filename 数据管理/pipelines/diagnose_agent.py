#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
经代/代理公司经营 KPI 诊断脚本

功能: 对指定三级机构下的经代公司进行全维度经营诊断（分年对比）
口径: 对齐 开发文档/01_指标体系.md + 监管 1/365 满期保费口径
数据: 直接读原始 parquet（经代名字段未进 PolicyFact 视图）

使用:
    python3 数据管理/pipelines/diagnose_agent.py --org 青羊 --agent "中升"
    python3 数据管理/pipelines/diagnose_agent.py --org 青羊 --agent "中升" --years 2025 2026
    python3 数据管理/pipelines/diagnose_agent.py --org 天府 --agent "诚安达" --precise-earned

版本: 1.0.0
作者: @claude
日期: 2026-03-27
"""

import argparse
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

try:
    import duckdb
except ImportError:
    print("错误: 需要 duckdb 包。运行: pip3 install duckdb")
    sys.exit(1)


# ============================================================================
# 路径常量
# ============================================================================

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
POLICY_GLOB = str(PROJECT_ROOT / "数据管理/warehouse/fact/policy/current/*.parquet")
# claims/latest.parquet 已废弃，赔付字段内嵌在 policy 分片中
DEFAULT_OUTPUT_DIR = str(PROJECT_ROOT / "数据分析报告")

# 阈值（来自 开发文档/01_指标体系.md）
THRESHOLDS = {
    "变动成本率_预警": 91.0,
    "变动成本率_危险": 94.0,
    "满期赔付率_预警": 75.0,
    "费用率_预警": 17.0,
    "费用率_危险": 14.0,  # 注意：费用率越低越好，14%是"危险"下限
    "出险率_非摩托": 12.0,
    "出险率_摩托": 15.0,
    "案均赔款_非摩托": 4900,
    "案均赔款_摩托": 4500,
}


# ============================================================================
# DataLoader
# ============================================================================

class DataLoader:
    """DuckDB 内存视图管理器"""

    def __init__(self):
        self.con = duckdb.connect()

    def build_views(self, org: str, agent: str, years: list[int], ytd_filter: str = ""):
        """创建经代筛选视图和机构基准视图
        ytd_filter: 可选的 YTD 日期过滤 SQL 片段，如 "AND (MONTH(签单日期) < 3 OR ...)"
        """
        years_csv = ", ".join(str(y) for y in years)
        org_esc = org.replace("'", "''")
        agent_esc = agent.replace("'", "''")

        # 经代视图（赔付字段已内嵌在 policy 分片中，无需 JOIN claims）
        self.con.execute(f"""
            CREATE OR REPLACE VIEW v_agent AS
            SELECT *,
                   COALESCE(赔案件数, 0) AS _赔案件数,
                   COALESCE(已报告赔款, 0) AS _已报告赔款,
                   COALESCE(费用金额, 0) AS _费用金额
            FROM read_parquet('{POLICY_GLOB}', union_by_name=true)
            WHERE 三级机构 = '{org_esc}'
              AND 经代名 LIKE '%{agent_esc}%'
              AND YEAR(签单日期) IN ({years_csv})
              {ytd_filter}
        """)

        # 机构整体视图（用于对比）
        self.con.execute(f"""
            CREATE OR REPLACE VIEW v_org AS
            SELECT *,
                   COALESCE(赔案件数, 0) AS _赔案件数,
                   COALESCE(已报告赔款, 0) AS _已报告赔款,
                   COALESCE(费用金额, 0) AS _费用金额
            FROM read_parquet('{POLICY_GLOB}', union_by_name=true)
            WHERE 三级机构 = '{org_esc}'
              AND YEAR(签单日期) IN ({years_csv})
              {ytd_filter}
        """)

    def resolve_agent_name(self, org: str, agent: str) -> Optional[str]:
        """模糊匹配经代名，返回精确名称或 None"""
        result = self.con.execute(f"""
            SELECT DISTINCT 经代名, COUNT(*) as cnt
            FROM read_parquet('{POLICY_GLOB}', union_by_name=true)
            WHERE 三级机构 = '{org}' AND 经代名 LIKE '%{agent}%'
            GROUP BY 经代名
            ORDER BY cnt DESC
        """).fetchall()

        if not result:
            return None
        if len(result) == 1:
            return result[0][0]

        # 多个匹配，列出让用户选择
        print(f"\n模糊匹配「{agent}」命中 {len(result)} 个经代公司：")
        for i, (name, cnt) in enumerate(result, 1):
            print(f"  [{i}] {name} ({cnt:,d} 条记录)")

        while True:
            choice = input("\n请输入序号选择（或 q 退出）: ").strip()
            if choice.lower() == 'q':
                return None
            try:
                idx = int(choice) - 1
                if 0 <= idx < len(result):
                    return result[idx][0]
            except ValueError:
                pass
            print("无效输入，请重试。")

    def query(self, sql: str):
        """执行 SQL 并返回结果"""
        return self.con.execute(sql).fetchall()

    def query_df(self, sql: str):
        """执行 SQL 并返回列名 + 数据"""
        result = self.con.execute(sql)
        columns = [desc[0] for desc in result.description]
        rows = result.fetchall()
        return columns, rows


# ============================================================================
# DiagnosticsEngine — 核心 KPI + 辅助维度
# ============================================================================

class DiagnosticsEngine:
    """9 维度诊断引擎"""

    def __init__(self, loader: DataLoader, precise_earned: bool = False):
        self.db = loader
        self.precise = precise_earned

    def _earned_expr(self, premium_col: str = "保费",
                     start_col: str = "保险起期",
                     fee_col: str = "费用金额",
                     type_col: str = "险类") -> str:
        """满期保费 SQL 表达式（闰年感知：policy_term=365或366天）"""
        pt = f"DATE_DIFF('day', {start_col}, {start_col} + INTERVAL 1 YEAR)"
        ed = f"LEAST(DATE_DIFF('day', {start_col}, CURRENT_DATE), {pt})"
        if self.precise:
            return f"""
                ({premium_col} * (COALESCE({fee_col}, 0) / NULLIF({premium_col}, 0))
                 * CASE WHEN {type_col} = '交强险' THEN 0.82 ELSE 0.94 END)
                +
                ({premium_col} * (1 - COALESCE({fee_col}, 0) / NULLIF({premium_col}, 0))
                 * CAST({ed} AS DOUBLE) / CAST({pt} AS DOUBLE))
            """
        return f"{premium_col} * CAST({ed} AS DOUBLE) / CAST({pt} AS DOUBLE)"

    def dim_core_kpi(self) -> dict:
        """维度1: 核心 KPI（分年）"""
        earned = self._earned_expr()
        sql = f"""
            SELECT
                YEAR(签单日期) AS 年份,
                COUNT(*) AS 总记录数,
                COUNT(DISTINCT 保单号) AS 总保单数,
                COUNT(DISTINCT CASE WHEN 险类='商业保险' THEN 保单号 END) AS 商业险保单数,
                ROUND(SUM(保费), 0) AS 签单保费,
                ROUND(SUM(CASE WHEN 保费 > 0 THEN 保费 ELSE 0 END), 0) AS 毛保费,
                ROUND(SUM(CASE WHEN 保费 < 0 THEN 保费 ELSE 0 END), 0) AS 退费,
                ROUND(SUM(保费) / NULLIF(COUNT(DISTINCT DATE_TRUNC('month', 签单日期)), 0), 0) AS 月均保费,
                ROUND(SUM(保费) / NULLIF(COUNT(DISTINCT 签单日期::DATE), 0), 0) AS 日均保费,
                -- 满期
                ROUND(SUM({earned}), 0) AS 满期保费,
                ROUND(AVG(CAST(LEAST(DATE_DIFF('day', 保险起期, CURRENT_DATE), DATE_DIFF('day', 保险起期, 保险起期 + INTERVAL 1 YEAR)) AS DOUBLE)
                      / CAST(DATE_DIFF('day', 保险起期, 保险起期 + INTERVAL 1 YEAR) AS DOUBLE)) * 100, 1) AS 平均满期率,
                -- 赔付
                ROUND(SUM(已报告赔款), 0) AS 已报告赔款,
                SUM(赔案件数) AS 赔案件数,
                ROUND(SUM(已报告赔款) / NULLIF(SUM(赔案件数), 0), 0) AS 案均赔款,
                -- 费用
                ROUND(SUM(费用金额), 0) AS 费用金额,
                -- 率指标
                ROUND(SUM(已报告赔款) / NULLIF(SUM({earned}), 0) * 100, 1) AS 满期赔付率,
                ROUND(SUM(费用金额) / NULLIF(SUM(保费), 0) * 100, 1) AS 费用率,
                -- 续保
                SUM(CASE WHEN 是否续保 THEN 1 ELSE 0 END) AS 续保件数,
                ROUND(SUM(CASE WHEN 是否续保 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS 续保率,
                -- 交叉销售
                ROUND(SUM(COALESCE(交叉销售保费_驾意, 0)), 0) AS 驾意交叉销售保费,
                -- 满期出险率：(赔案/保单) × (保险期限/满期天数)
                COUNT(DISTINCT CASE WHEN _赔案件数 > 0 THEN 保单号 END) AS 有赔案保单数,
                ROUND(SUM(_赔案件数 * CAST(DATE_DIFF('day', 保险起期, 保险起期 + INTERVAL 1 YEAR) AS DOUBLE)
                      / NULLIF(CAST(LEAST(DATE_DIFF('day', 保险起期, CURRENT_DATE), DATE_DIFF('day', 保险起期, 保险起期 + INTERVAL 1 YEAR)) AS DOUBLE), 0))
                      / NULLIF(COUNT(DISTINCT 保单号), 0) * 100, 2) AS 满期出险率
            FROM v_agent
            GROUP BY YEAR(签单日期)
            ORDER BY 年份
        """
        return {"title": "核心 KPI", "data": self.db.query_df(sql)}

    def dim_insurance_type(self) -> dict:
        """维度2: 险类分拆"""
        earned = self._earned_expr()
        sql = f"""
            SELECT YEAR(签单日期) AS 年份, 险类,
                COUNT(*) AS 件数,
                COUNT(DISTINCT 保单号) AS 保单数,
                ROUND(SUM(保费), 0) AS 签单保费,
                ROUND(AVG(CASE WHEN 保费 > 0 THEN 保费 END), 0) AS 件均保费,
                ROUND(SUM(已报告赔款) / NULLIF(SUM({earned}), 0) * 100, 1) AS 满期赔付率,
                ROUND(SUM(费用金额) / NULLIF(SUM(保费), 0) * 100, 1) AS 费用率
            FROM v_agent
            GROUP BY YEAR(签单日期), 险类
            ORDER BY 年份, 签单保费 DESC
        """
        return {"title": "险类分拆", "data": self.db.query_df(sql)}

    def dim_customer_category(self) -> dict:
        """维度3: 客户类别"""
        sql = """
            SELECT YEAR(签单日期) AS 年份, 客户类别,
                COUNT(*) AS 件数,
                ROUND(SUM(保费), 0) AS 签单保费,
                ROUND(SUM(CASE WHEN 是否续保 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS 续保率
            FROM v_agent
            GROUP BY YEAR(签单日期), 客户类别
            ORDER BY 年份, 签单保费 DESC
        """
        return {"title": "客户类别", "data": self.db.query_df(sql)}

    def dim_coverage_combination(self) -> dict:
        """维度4: 险别组合"""
        sql = """
            SELECT YEAR(签单日期) AS 年份, 险别组合,
                COUNT(*) AS 件数,
                ROUND(SUM(保费), 0) AS 签单保费,
                ROUND(SUM(保费) * 100.0 / NULLIF(SUM(SUM(保费)) OVER (PARTITION BY YEAR(签单日期)), 0), 1) AS 保费占比
            FROM v_agent
            GROUP BY YEAR(签单日期), 险别组合
            ORDER BY 年份, 签单保费 DESC
        """
        return {"title": "险别组合", "data": self.db.query_df(sql)}

    def dim_monthly_trend(self) -> dict:
        """维度5: 月度趋势"""
        earned = self._earned_expr()
        sql = f"""
            SELECT
                DATE_TRUNC('month', 签单日期)::DATE AS 月份,
                COUNT(*) AS 件数,
                ROUND(SUM(保费), 0) AS 签单保费,
                ROUND(SUM({earned}), 0) AS 满期保费,
                ROUND(SUM(已报告赔款) / NULLIF(SUM({earned}), 0) * 100, 1) AS 满期赔付率,
                ROUND(SUM(费用金额) / NULLIF(SUM(保费), 0) * 100, 1) AS 费用率,
                SUM(赔案件数) AS 赔案件数
            FROM v_agent
            GROUP BY DATE_TRUNC('month', 签单日期)
            ORDER BY 月份
        """
        return {"title": "月度趋势", "data": self.db.query_df(sql)}

    def dim_salesman(self) -> dict:
        """维度6: 业务员维度"""
        sql = """
            SELECT YEAR(签单日期) AS 年份, 业务员,
                COUNT(*) AS 件数,
                ROUND(SUM(保费), 0) AS 签单保费,
                ROUND(AVG(CASE WHEN 保费 > 0 THEN 保费 END), 0) AS 件均保费,
                ROUND(SUM(CASE WHEN 是否续保 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS 续保率,
                ROUND(SUM(COALESCE(交叉销售保费_驾意, 0)), 0) AS 驾意保费
            FROM v_agent
            GROUP BY YEAR(签单日期), 业务员
            ORDER BY 年份, 签单保费 DESC
        """
        return {"title": "业务员维度", "data": self.db.query_df(sql)}

    def dim_pricing_factor(self) -> dict:
        """维度7: 商车系数分布"""
        sql = """
            SELECT YEAR(签单日期) AS 年份,
                ROUND(AVG(商车自主定价系数), 4) AS 均值,
                ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY 商车自主定价系数), 4) AS 中位数,
                ROUND(MIN(商车自主定价系数), 4) AS 最低,
                ROUND(MAX(商车自主定价系数), 4) AS 最高,
                COUNT(*) AS 商业险件数,
                ROUND(SUM(CASE WHEN 商车自主定价系数 < 0.7 THEN 1 ELSE 0 END) * 100.0
                      / NULLIF(COUNT(*), 0), 1) AS 低系数占比_70,
                ROUND(SUM(CASE WHEN 商车自主定价系数 < 0.85 THEN 1 ELSE 0 END) * 100.0
                      / NULLIF(COUNT(*), 0), 1) AS 低系数占比_85
            FROM v_agent
            WHERE 险类 = '商业保险' AND 商车自主定价系数 IS NOT NULL
            GROUP BY YEAR(签单日期)
            ORDER BY 年份
        """
        return {"title": "商车系数分布", "data": self.db.query_df(sql)}

    def dim_benchmark(self) -> dict:
        """维度8: 经代 vs 机构整体对比"""
        earned = self._earned_expr()
        sql = f"""
            SELECT 年份, 维度, 签单保费, 满期保费, 已报告赔款, 费用金额,
                   满期赔付率, 费用率,
                   ROUND(满期赔付率 + 费用率, 1) AS 变动成本率,
                   保单数, 赔案件数
            FROM (
                SELECT YEAR(签单日期) AS 年份, '经代公司' AS 维度,
                    ROUND(SUM(保费), 0) AS 签单保费,
                    ROUND(SUM({earned}), 0) AS 满期保费,
                    ROUND(SUM(已报告赔款), 0) AS 已报告赔款,
                    ROUND(SUM(费用金额), 0) AS 费用金额,
                    ROUND(SUM(已报告赔款) / NULLIF(SUM({earned}), 0) * 100, 1) AS 满期赔付率,
                    ROUND(SUM(费用金额) / NULLIF(SUM(保费), 0) * 100, 1) AS 费用率,
                    COUNT(DISTINCT 保单号) AS 保单数,
                    SUM(赔案件数) AS 赔案件数
                FROM v_agent GROUP BY YEAR(签单日期)
                UNION ALL
                SELECT YEAR(签单日期), '机构整体',
                    ROUND(SUM(保费), 0),
                    ROUND(SUM({earned}), 0),
                    ROUND(SUM(已报告赔款), 0),
                    ROUND(SUM(费用金额), 0),
                    ROUND(SUM(已报告赔款) / NULLIF(SUM({earned}), 0) * 100, 1),
                    ROUND(SUM(费用金额) / NULLIF(SUM(保费), 0) * 100, 1),
                    COUNT(DISTINCT 保单号),
                    SUM(赔案件数)
                FROM v_org GROUP BY YEAR(签单日期)
            ) t
            ORDER BY 年份, 维度
        """
        return {"title": "经代 vs 机构整体", "data": self.db.query_df(sql)}

    def dim_cross_sell(self) -> dict:
        """维度10: 驾乘险（推介率/渗透率/保费/件均）
        口径：
          推介率 = 交叉销售为是的商业险保单数 / 商业险保单数
          渗透率 = 驾乘保费 / 车险签单保费
        """
        sql = """
            SELECT YEAR(签单日期) AS 年份,
                COUNT(DISTINCT CASE WHEN 险类='商业保险' THEN 保单号 END) AS 商业险保单数,
                COUNT(DISTINCT CASE WHEN 险类='商业保险' AND 交叉销售标识 THEN 保单号 END) AS 驾乘推介保单数,
                ROUND(COUNT(DISTINCT CASE WHEN 险类='商业保险' AND 交叉销售标识 THEN 保单号 END) * 100.0
                      / NULLIF(COUNT(DISTINCT CASE WHEN 险类='商业保险' THEN 保单号 END), 0), 1) AS 驾乘推介率,
                ROUND(SUM(COALESCE(交叉销售保费_驾意, 0)), 0) AS 驾乘保费,
                ROUND(SUM(保费), 0) AS 车险签单保费,
                ROUND(SUM(COALESCE(交叉销售保费_驾意, 0)) * 100.0
                      / NULLIF(SUM(保费), 0), 1) AS 驾乘渗透率,
                ROUND(SUM(COALESCE(交叉销售保费_驾意, 0))
                      / NULLIF(COUNT(DISTINCT CASE WHEN 险类='商业保险' AND 交叉销售标识 THEN 保单号 END), 0), 0) AS 驾乘件均
            FROM v_agent
            GROUP BY YEAR(签单日期)
            ORDER BY 年份
        """
        return {"title": "驾乘险", "data": self.db.query_df(sql)}

    def dim_loss_exposure(self) -> dict:
        """维度9: 损失暴露（出险率 + 案均赔款）"""
        sql = """
            SELECT YEAR(签单日期) AS 年份,
                COUNT(DISTINCT 保单号) AS 保单数,
                COUNT(DISTINCT CASE WHEN 赔案件数 > 0 THEN 保单号 END) AS 有赔案保单数,
                ROUND(COUNT(DISTINCT CASE WHEN 赔案件数 > 0 THEN 保单号 END) * 100.0
                      / NULLIF(COUNT(DISTINCT 保单号), 0), 1) AS 出险率,
                SUM(赔案件数) AS 赔案总件数,
                ROUND(SUM(已报告赔款) / NULLIF(SUM(赔案件数), 0), 0) AS 案均赔款,
                ROUND(SUM(已报告赔款), 0) AS 已报告赔款
            FROM v_agent
            GROUP BY YEAR(签单日期)
            ORDER BY 年份
        """
        return {"title": "损失暴露", "data": self.db.query_df(sql)}

    def run_all(self) -> list[dict]:
        """执行所有维度"""
        return [
            self.dim_core_kpi(),
            self.dim_insurance_type(),
            self.dim_customer_category(),
            self.dim_coverage_combination(),
            self.dim_monthly_trend(),
            self.dim_salesman(),
            self.dim_pricing_factor(),
            self.dim_benchmark(),
            self.dim_loss_exposure(),
            self.dim_cross_sell(),
        ]


# ============================================================================
# ReportWriter — Markdown 输出
# ============================================================================

class ReportWriter:
    """Markdown 报告生成器"""

    def __init__(self, org: str, agent_full: str, years: list[int]):
        self.org = org
        self.agent_full = agent_full
        self.years = years
        self.lines: list[str] = []

    def _add(self, text: str = ""):
        self.lines.append(text)

    def _table(self, columns: list[str], rows: list[tuple]):
        """生成 Markdown 表格"""
        self._add("| " + " | ".join(str(c) for c in columns) + " |")
        self._add("| " + " | ".join("---" for _ in columns) + " |")
        for row in rows:
            cells = []
            for v in row:
                if v is None:
                    cells.append("-")
                elif isinstance(v, float):
                    cells.append(f"{v:,.1f}" if abs(v) < 1000 else f"{v:,.0f}")
                elif isinstance(v, int):
                    # 年份不加千分位
                    cells.append(str(v) if 2000 <= v <= 2099 else f"{v:,d}")
                else:
                    cells.append(str(v))
            self._add("| " + " | ".join(cells) + " |")

    def _status(self, value: float, warn: float, danger: float,
                higher_is_worse: bool = True) -> str:
        """生成预警标记"""
        if value is None:
            return ""
        if higher_is_worse:
            if value > danger:
                return " ⛔危险"
            if value > warn:
                return " ⚠️预警"
            return " ✅正常"
        else:
            if value < danger:
                return " ⛔危险"
            if value < warn:
                return " ⚠️预警"
            return " ✅正常"

    def write_header(self):
        self._add(f"# 经代公司经营诊断报告")
        self._add()
        self._add(f"- **三级机构**: {self.org}")
        self._add(f"- **经代公司**: {self.agent_full}")
        self._add(f"- **分析年份**: {', '.join(str(y) for y in self.years)}")
        self._add(f"- **生成时间**: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
        self._add(f"- **满期保费口径**: 监管 1/365 封顶规则")
        self._add()

    def write_core_kpi(self, data: dict):
        cols, rows = data["data"]
        self._add("## 1. 核心 KPI\n")
        if not rows:
            self._add("*无数据*\n")
            return

        for row in rows:
            d = dict(zip(cols, row))
            yr = d["年份"]
            premium = d["签单保费"]
            earned = d["满期保费"]
            claims_rate = d["满期赔付率"] or 0
            fee_rate = d["费用率"] or 0
            variable_cost = claims_rate + fee_rate
            margin_rate = 100 - variable_cost if variable_cost else None
            claim_policies = d["有赔案保单数"]
            total_policies = d["总保单数"]
            incident_rate = d.get("满期出险率") or 0  # 直接使用 SQL 层年化公式，禁止 Python 层重算

            self._add(f"### {yr}年\n")
            self._add(f"| 指标 | 数值 | 状态 |")
            self._add(f"| --- | --- | --- |")
            self._add(f"| 签单保费 | {premium:,.0f}元 ({premium/10000:,.1f}万) | |")
            self._add(f"| 毛保费 | {d['毛保费']:,.0f}元 | 退费: {d['退费']:,.0f}元 |")
            self._add(f"| 月均保费 | {d['月均保费']:,.0f}元 | |")
            self._add(f"| 日均保费 | {d['日均保费']:,.0f}元 | |")
            self._add(f"| 商业险保单数 | {d['商业险保单数']:,d} | |")
            self._add(f"| 满期保费 | {earned:,.0f}元 | 满期率: {d['平均满期率']:.1f}% |")
            self._add(f"| 已报告赔款 | {d['已报告赔款']:,.0f}元 | 赔案: {d['赔案件数']:,d}件 |")
            self._add(f"| 案均赔款 | {d['案均赔款']:,.0f}元 | |" if d['案均赔款'] else "| 案均赔款 | - | |")
            self._add(f"| 费用金额 | {d['费用金额']:,.0f}元 | |")
            self._add(f"| **满期赔付率** | **{claims_rate:.1f}%** |{self._status(claims_rate, 75, 75)} |")
            self._add(f"| **费用率** | **{fee_rate:.1f}%** |{self._status(fee_rate, 17, 14)} |")
            self._add(f"| **变动成本率** | **{variable_cost:.1f}%** |{self._status(variable_cost, 91, 94)} |")
            self._add(f"| **边际贡献率** | **{margin_rate:.1f}%** | |" if margin_rate else "| 边际贡献率 | - | |")
            self._add(f"| 满期出险率 | {incident_rate:.1f}% | |")
            self._add(f"| 续保率 | {d['续保率']:.1f}% | {d['续保件数']:,d}件 |")
            self._add(f"| 驾意交叉销售保费 | {d['驾意交叉销售保费']:,.0f}元 | |")
            self._add()

    def write_table_section(self, num: int, data: dict):
        cols, rows = data["data"]
        self._add(f"## {num}. {data['title']}\n")
        if not rows:
            self._add("*无数据*\n")
            return
        self._table(cols, rows)
        self._add()

    def write_monthly_trend(self, data: dict):
        cols, rows = data["data"]
        self._add("## 5. 月度趋势\n")
        if not rows:
            self._add("*无数据*\n")
            return

        self._table(cols, rows)
        self._add()

        # ASCII 柱状图
        max_premium = max((r[2] for r in rows if r[2]), default=1)
        self._add("```")
        self._add("月度保费趋势：")
        for row in rows:
            month_str = str(row[0])[:7]
            premium = row[2] or 0
            bar_len = max(1, int(premium / max_premium * 40))
            self._add(f"  {month_str} | {'█' * bar_len} {premium:>10,.0f}")
        self._add("```\n")

    def write_benchmark(self, data: dict):
        cols, rows = data["data"]
        self._add("## 8. 经代 vs 机构整体对比\n")
        if not rows:
            self._add("*无数据*\n")
            return

        self._table(cols, rows)
        self._add()

        # 计算占比
        by_year = {}
        for row in rows:
            d = dict(zip(cols, row))
            yr = d["年份"]
            if yr not in by_year:
                by_year[yr] = {}
            by_year[yr][d["维度"]] = d

        for yr, dims in sorted(by_year.items()):
            if "经代公司" in dims and "机构整体" in dims:
                a = dims["经代公司"]
                o = dims["机构整体"]
                prem_pct = a["签单保费"] / o["签单保费"] * 100 if o["签单保费"] else 0
                pol_pct = a["保单数"] / o["保单数"] * 100 if o["保单数"] else 0
                self._add(f"**{yr}年占比**: 保费 {prem_pct:.1f}% | 保单 {pol_pct:.1f}%\n")

    def write_summary(self, dimensions: list[dict]):
        """诊断总结"""
        self._add("## 诊断总结\n")

        # 从核心 KPI 提取关键发现
        kpi_data = dimensions[0]["data"]
        cols, rows = kpi_data
        findings = []

        for row in rows:
            d = dict(zip(cols, row))
            yr = d["年份"]
            claims_rate = d["满期赔付率"] or 0
            fee_rate = d["费用率"] or 0
            vc = claims_rate + fee_rate
            renewal = d["续保率"]

            if vc > 94:
                findings.append(f"- ⛔ {yr}年变动成本率 {vc:.1f}% 超过危险线(94%)")
            elif vc > 91:
                findings.append(f"- ⚠️ {yr}年变动成本率 {vc:.1f}% 超过预警线(91%)")
            else:
                findings.append(f"- ✅ {yr}年变动成本率 {vc:.1f}% 处于正常区间")

            if claims_rate > 75:
                findings.append(f"- ⛔ {yr}年满期赔付率 {claims_rate:.1f}% 超过预警线(75%)")

            if fee_rate > 17:
                findings.append(f"- ⚠️ {yr}年费用率 {fee_rate:.1f}% 超过预警线(17%)")

            if renewal == 0:
                findings.append(f"- ⚠️ {yr}年续保率为 0%，需关注客户留存")

        if findings:
            for f in findings:
                self._add(f)
            self._add()

    def save(self, output_dir: str) -> str:
        """保存报告"""
        # 提取经代简称：取括号内的关键词（如"中升"）或前10个编码后字符
        import re
        match = re.search(r'[（(](.{2,4})[）)]', self.agent_full)
        if match:
            agent_short = match.group(1)
        else:
            # 去掉前缀编码，取公司名前几个字
            name_part = re.sub(r'^[\d]+', '', self.agent_full)
            agent_short = name_part[:4] if name_part else self.agent_full[10:14]
        agent_short = "".join(c for c in agent_short if c.isalnum() or c in "._-")

        date_str = datetime.now().strftime("%Y%m%d")
        filename = f"agent_diagnosis_{self.org}_{agent_short}_{date_str}.md"
        filepath = Path(output_dir) / filename

        filepath.parent.mkdir(parents=True, exist_ok=True)
        filepath.write_text("\n".join(self.lines), encoding="utf-8")
        return str(filepath)


# ============================================================================
# main
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="经代/代理公司经营 KPI 诊断",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python3 数据管理/pipelines/diagnose_agent.py --org 青羊 --agent "中升"
  python3 数据管理/pipelines/diagnose_agent.py --org 青羊 --agent "中升" --years 2025 2026
  python3 数据管理/pipelines/diagnose_agent.py --org 天府 --agent "诚安达" --precise-earned
        """,
    )
    parser.add_argument("--org", required=True, help="三级机构名称（如：青羊、天府、宜宾）")
    parser.add_argument("--agent", required=True, help="经代公司名称（支持模糊匹配，如：中升、升华）")
    parser.add_argument("--years", nargs="+", type=int, default=[2025, 2026],
                        help="分析年份（默认: 2025 2026）")
    parser.add_argument("--output", default=DEFAULT_OUTPUT_DIR, help="输出目录")
    parser.add_argument("--compare", choices=["ytd", "full"], default=None,
                        help="YoY 对比口径: ytd=同期对比, full=全年对比. 不指定时自动检测并提示选择")
    parser.add_argument("--precise-earned", action="store_true",
                        help="使用精确满期保费（含费用率+险类系数）")
    parser.add_argument("--verbose", action="store_true", help="打印调试信息")

    args = parser.parse_args()

    print(f"🔍 经代公司经营诊断")
    print(f"   机构: {args.org} | 经代: {args.agent} | 年份: {args.years}")
    print()

    # 1. 初始化
    loader = DataLoader()

    # 2. 解析经代名
    print("📂 解析经代名...")
    agent_full = loader.resolve_agent_name(args.org, args.agent)
    if not agent_full:
        print(f"❌ 未找到匹配「{args.agent}」的经代公司（机构: {args.org}）")
        sys.exit(1)
    print(f"   匹配: {agent_full}")

    # 2.5 YTD 口径检测（查所有指定年份中的最新签单日期）
    max_yr = max(args.years)
    years_csv = ", ".join(str(y) for y in args.years)
    org_esc = args.org.replace("'", "''")
    agent_esc = args.agent.replace("'", "''")
    max_sign_row = loader.query(f"""
        SELECT MAX(签单日期)::DATE
        FROM read_parquet('{POLICY_GLOB}', union_by_name=true)
        WHERE 三级机构 = '{org_esc}' AND 经代名 LIKE '%{agent_esc}%'
          AND YEAR(签单日期) IN ({years_csv})
    """)
    max_sign = max_sign_row[0][0] if max_sign_row else None
    ytd_filter = ""
    ytd_label = "全年"

    if max_sign:
        if isinstance(max_sign, str):
            _ms = datetime.strptime(max_sign, "%Y-%m-%d").date()
        else:
            _ms = max_sign
        ytd_month, ytd_day = _ms.month, _ms.day
        latest_incomplete = not (ytd_month == 12 and ytd_day >= 25)

        compare_mode = args.compare
        if compare_mode is None and latest_incomplete:
            print(f"\n⚠️  最新签单日期 {max_sign}，{max_yr}年数据不完整。")
            print(f"   YoY 对比口径选择：")
            print(f"     [1] 同期对比 — 各年均取 1月1日-{ytd_month}月{ytd_day}日（推荐，增长率可比）")
            print(f"     [2] 全年对比 — 历史年用全年，{max_yr}年用已有数据（绝对值更完整）")
            try:
                choice = input("   请选择 [1/2]（默认1）: ").strip()
            except (EOFError, KeyboardInterrupt):
                choice = "1"
            compare_mode = "full" if choice == "2" else "ytd"
        elif compare_mode is None:
            compare_mode = "full"

        if compare_mode == "ytd" and latest_incomplete:
            ytd_filter = f"AND (MONTH(签单日期) < {ytd_month} OR (MONTH(签单日期) = {ytd_month} AND DAY(签单日期) <= {ytd_day}))"
            ytd_label = f"1月1日-{ytd_month}月{ytd_day}日"

    # 3. 建视图
    print("📊 加载数据...")
    loader.build_views(args.org, args.agent, args.years, ytd_filter)
    print(f"   📊 YoY 口径: {ytd_label}")

    # 验证数据量
    count = loader.query("SELECT COUNT(*) FROM v_agent")[0][0]
    if count == 0:
        print(f"❌ 筛选后无数据（机构={args.org}, 经代≈{args.agent}, 年份={args.years}）")
        sys.exit(1)
    print(f"   经代数据: {count:,d} 条 | 开始诊断...\n")

    # 4. 执行诊断
    engine = DiagnosticsEngine(loader, precise_earned=args.precise_earned)
    dimensions = engine.run_all()

    # 5. 生成报告
    writer = ReportWriter(args.org, agent_full, args.years)
    writer.write_header()
    writer.write_core_kpi(dimensions[0])
    writer.write_table_section(2, dimensions[1])  # 险类
    writer.write_table_section(3, dimensions[2])  # 客户类别
    writer.write_table_section(4, dimensions[3])  # 险别组合
    writer.write_monthly_trend(dimensions[4])      # 月度趋势
    writer.write_table_section(6, dimensions[5])  # 业务员
    writer.write_table_section(7, dimensions[6])  # 商车系数
    writer.write_benchmark(dimensions[7])          # 对比
    writer.write_table_section(9, dimensions[8])  # 损失暴露
    writer.write_table_section(10, dimensions[9])  # 驾乘险
    writer.write_summary(dimensions)

    # 6. 保存
    filepath = writer.save(args.output)
    print(f"✅ 报告已生成: {filepath}")
    print(f"   共 {len(writer.lines)} 行 Markdown")

    # 7. 同时输出到 stdout
    print("\n" + "=" * 60)
    print("\n".join(writer.lines))


if __name__ == "__main__":
    main()
