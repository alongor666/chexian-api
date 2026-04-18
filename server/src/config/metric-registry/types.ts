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
  | 'repair';      // 维修资源：修保比、本地资源占比、合作启用率

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
export interface MetricDefinition {
  // ===== 标识 =====
  readonly id: string;             // snake_case 唯一 ID
  readonly version: string;        // 当前版本号 semver

  // ===== 描述 =====
  readonly name: string;           // 中文名称
  readonly category: MetricCategory;
  readonly tags: readonly string[];

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

  // ===== 版本历史 =====
  readonly changelog: readonly MetricVersion[];
}
