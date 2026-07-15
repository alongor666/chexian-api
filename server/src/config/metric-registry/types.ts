/**
 * 指标注册表核心类型定义
 *
 * 设计原则：
 * - 只注册 L1-L3 原子指标（可用单行 SQL 表达式）
 * - L4 复杂查询（CTE/窗口函数/多表 JOIN）留在 SQL 生成器中
 * - 最小必要字段集，YAGNI
 */

/** 指标分类 */
export type MetricCategory =
  | 'foundation'   // 基础指标：保费、件数、人均
  | 'ratio'        // 比率指标：续保率、商业险占比、新能源率
  | 'cost'         // 成本指标：赔付率、费用率、综合费用率
  | 'cross_sell'   // 交叉销售：驾意险推介率
  | 'growth'       // 增长指标：同比、环比
  | 'repair'       // 维修资源：修保比、本地资源占比、合作启用率
  | 'plan'         // 计划达成：年度计划/时间进度达成率
  | 'structure'    // 业务结构：客户类别占比、车型占比
  | 'renewal'      // 续保分析：应续/报价/已续/未报价/流失件数、续保影响度（数据源 RenewalTrackerFact 派生域）
  | 'sales_team';  // 销售队伍业绩：标保/实收保费/明细行数（数据源 SalesTeamPerformanceFact 独立域）

/** 格式化函数 ID（与 src/shared/utils/formatters.ts 对应） */
export type FormatterId =
  | 'count'            // 件数：整数，千分位
  | 'average'          // 均值：1位小数，千分位
  | 'premiumWan'       // 保费：万元，整数，千分位
  | 'driverPremiumWan' // 驾意险保费：万元，自适应小数
  | 'percent'          // 百分比：1位小数，%
  | 'coefficient'      // 系数：4位小数
  | 'chartValue'       // 图表值：纯数字
  | 'achievementRate'; // 达成率：小数→百分比

/** 版本变更记录 */
export interface MetricVersion {
  readonly version: string;  // semver: "1.0.0"
  readonly date: string;     // "2026-03-27"
  readonly changes: string;  // 变更说明
}

/** 测试断言语法 — Phase 1 只做结构性断言 */
export type TestAssertion =
  | { readonly op: 'gt'; readonly value: number }                       // > N
  | { readonly op: 'gte'; readonly value: number }                      // >= N
  | { readonly op: 'between'; readonly min: number; readonly max: number }  // min <= x <= max
  | { readonly op: 'type'; readonly value: 'number' | 'string' }       // 类型检查
  | { readonly op: 'notNull' }                                         // 非空
  | number;                                                             // 精确值

/**
 * 四级亮灯方向（与 ~/.claude/skills/chexian-report-shell/lib/alerts.py:LOWER_WORSE 对齐）
 *
 * - higher_worse: 数值越高越差。val > danger → 危险 / > warn → 异常 / > notice → 健康 / 否则 优秀
 * - lower_worse:  数值越低越差。val < danger → 危险 / < warn → 异常 / < notice → 健康 / 否则 优秀
 */
export type AlertDirection = 'higher_worse' | 'lower_worse';

/**
 * 四级亮灯阈值（3 个分界点 → 4 个等级：优秀/健康/异常/危险）
 *
 * 与诊断技能 lib/alerts.py:TH 一一对应。注册表本身不执行打灯逻辑，
 * 仅作为前端/看板/外部脚本的事实源（避免硬编码阈值）。
 *
 * 元组顺序约定（同 alerts.py）：(notice, warn, danger)
 *   - higher_worse 时 notice < warn < danger
 *   - lower_worse  时 notice > warn > danger
 */
export interface MetricThresholds {
  readonly direction: AlertDirection;
  readonly notice: number;   // 优秀 / 健康 分界
  readonly warn: number;     // 健康 / 异常 分界
  readonly danger: number;   // 异常 / 危险 分界
  readonly unit: string;     // 阈值单位（"%" | "元" ...）
  readonly source?: string;  // 来源说明，例如 "skills/chexian-report-shell/lib/alerts.py v1.7"
}

/** 测试用例 */
export interface MetricTestCase {
  readonly name: string;
  readonly input: {
    readonly whereClause: string;
    readonly groupBy?: string;
  };
  readonly assertions: Readonly<Record<string, TestAssertion>>;
}

/** 指标定义 — 注册表核心条目 */
/**
 * 指标固有时间窗口语义（B290 口径消歧，与路由层 RouteTimeWindow 配合）：
 * - 'any'：窗口完全随查询路由的 WHERE 决定，指标本身无固有时间语义
 * - 'cutoff-based'：指标内嵌观察时点逻辑，数值随观察截止日变化，跨窗口比较时必须对齐 cutoff。
 *   涵盖两类：(1) 满期系数/年化成熟度族（满期保费/满期赔付率/年化出险率）；
 *   (2) 计划进度锚定族——计划达成率以「数据内最新签单日」为时间进度锚点，离散月度需用
 *   官方派生口径（年计划 ÷ 12），故同属随截止日变化、禁止与自由窗口口径混用。
 *
 * 注册表层校验（validation.ts）强制每个指标显式声明，消除缺省歧义。类型上保持可选
 * 仅为兼容注册表外的 MetricDefinition 构造点（比照 additive）。
 */
export type MetricTimeWindow = 'any' | 'cutoff-based';

export interface MetricDefinition {
  // ===== 标识 =====
  readonly id: string;             // snake_case 唯一 ID
  readonly version: string;        // 当前版本号 semver

  // ===== 描述 =====
  readonly name: string;           // 中文名称
  readonly category: MetricCategory;
  readonly tags: readonly string[];

  // ===== 时间窗口语义（注册表内强制显式声明，类型可选仅兼容外部构造点） =====
  readonly timeWindow?: MetricTimeWindow;

  // ===== 可加性（cube 语义层聚合路由，P2）=====
  /**
   * 该指标是否「可加」（roll-up additive）：跨不相交分区各自聚合后**直接求和**等于整体值。
   *
   * - `true`：顶层是 `SUM(...)`（含 `ROUND(SUM(...))`）的逐行求和，如 total_premium / earned_premium。
   *   可由立方体预聚合分区相加加速。
   * - `false`：比率（分子分母两段聚合相除）/ 均值 / `COUNT(DISTINCT ...)` / 增长率 / L4 复合占位。
   *   **禁止对率值或 DISTINCT 计数求和**（车险铁律：率值聚合永远 SUM(分子)/SUM(分母)），
   *   cube 必须按目标维度子集**重算**或回退原路径。
   *
   * 判定保守：拿不准一律 `false`（false = 重算，永远正确；误判 true 会让 cube 错误求和）。
   * 注册表层校验（validation.ts）强制每个指标显式声明，避免静默缺省。类型上保持可选
   * 仅为兼容注册表外的 MetricDefinition 构造点（如 agent registry）。
   */
  readonly additive?: boolean;

  // ===== 公式 =====
  readonly formula: {
    readonly description: string;  // 公式语义："已报告赔款 / 满期保费"
    readonly numerator?: string;   // 分子描述
    readonly denominator?: string; // 分母描述
    readonly unit: string;         // "元" | "%" | "件" | "人" | "次"
  };

  // ===== SQL =====
  readonly sql: {
    readonly expression: string;          // DuckDB SQL 片段，含 AS alias
    readonly requiredColumns: readonly string[];  // 依赖的底表字段
    readonly notes?: string;              // SQL 注意事项
  };

  // ===== 展示 =====
  readonly display: {
    readonly formatter: FormatterId;
    readonly label: string;        // 前端展示标签
    readonly unit?: string;        // "万元" | "%" | "件"
    readonly decimals?: number;    // 覆盖 formatter 默认小数位
    readonly tooltip?: string;     // 鼠标悬停提示
  };

  // ===== 测试 =====
  readonly testCases: readonly MetricTestCase[];  // 至少 1 个

  // ===== 四级亮灯阈值（可选） =====
  readonly thresholds?: MetricThresholds;

  // ===== 版本历史 =====
  readonly changelog: readonly MetricVersion[];
}
