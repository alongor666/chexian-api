/**
 * 时间口径反问协议（B290 语义层 v0.1，机器可读 SSOT）
 *
 * 定义"何种时间口径歧义应让 LLM 先反问用户、而非自由选一个口径作答"。
 * 缘起：2026-05-12 用户问"5/1 到 5/11 分公司保费完成率排行"，不同 LLM 解读出
 * 314%（YTD 进度口径）vs 22%（窗口÷月计划口径）两个截然不同的答案——同一问题缺乏
 * 约束导致答案不一致。本协议把"应反问"的判定固化为结构化数据，跨 CLI/MCP/前端共享。
 *
 * 用户决策（2026-06-22）：4 类触发全部纳入。
 *
 * 消费面（v0.1）：
 *   - query-routes-metadata.ts 的 ytd-progress 路由 timeWindowNote 经 composeAskBackHint()
 *     拼装反问指令 → 既有 MCP tool description（build-tools.ts）+ CLI `--describe` 自动透出
 *   - .claude/rules/time-caliber-disambiguation.md 给会话级 LLM 阅读
 * 后续（非本 loop）：/api/discover 端点透出 + 运行时强制拒绝路径（已登记 follow-up）。
 */

import type { RouteTimeWindow } from './query-routes-metadata.js';

/** 4 类时间口径歧义触发 id */
export type DisambiguationTriggerId =
  | 'window-vs-progress' // T1 窗口 × 进度冲突（原始事故）
  | 'denominator-period' // T2 分母周期不明
  | 'cross-caliber' // T3 跨口径横向对比
  | 'date-anchor'; // T4 日期锚点歧义

/** 一条反问触发规则 */
export interface DisambiguationTrigger {
  readonly id: DisambiguationTriggerId;
  /** 中文触发名 */
  readonly name: string;
  /** 触发条件（中文，描述何时该反问） */
  readonly triggerWhen: string;
  /** 反问模板（中文，给 LLM 直接套用的二选一/确认句式） */
  readonly askBackTemplate: string;
  /**
   * 关联的路由时间口径（用于把反问提示自动挂到对应路由的 timeWindowNote）。
   * 空数组 = 跨切面触发（T3 指标级 / T4 日期字段级），不绑定单一路由口径，仅在
   * 协议文档与会话级 LLM 协议中约束。
   */
  readonly relatedTimeWindows: readonly RouteTimeWindow[];
}

/**
 * 反问协议 SSOT（4 类触发，全部纳入——用户 2026-06-22 决策）。
 */
export const DISAMBIGUATION_PROTOCOL: readonly DisambiguationTrigger[] = [
  {
    id: 'window-vs-progress',
    name: '窗口 × 进度冲突',
    triggerWhen:
      '用户给了具体日期窗口（如 5/1-5/11）却查询"完成率/达成率/计划进度"这类年度计划进度（YTD 进度）指标',
    askBackTemplate:
      '您要的是【截至该日期、按时间进度折算的年度计划达成率】，还是【该日期窗口期内的实际保费/窗口口径】？二者口径不同、数值差异极大，请确认。',
    relatedTimeWindows: ['ytd-progress'],
  },
  {
    id: 'denominator-period',
    name: '分母周期不明',
    triggerWhen: '用户问"月度/季度计划达成"，但系统仅有年度计划、无真实逐月/逐季计划',
    askBackTemplate:
      '系统无真实逐月计划，月度/季度计划取官方派生口径【年计划 ÷ 12（月度）或按时间占比】。是否采用该派生口径？',
    relatedTimeWindows: ['ytd-progress'],
  },
  {
    id: 'cross-caliber',
    name: '跨口径横向对比',
    triggerWhen:
      '用户要把不同时间口径的指标并列排名/相加（如把 cutoff-based 满期赔付率与自由窗口保费并列，或把发展三角形不同成熟度横向比）',
    askBackTemplate:
      '这些指标时间口径不同（满期/年化随观察截止日变化 vs 窗口口径随筛选区间变化），直接并列会误导。是否需先对齐到同一 cutoff 再对比？',
    relatedTimeWindows: [],
  },
  {
    id: 'date-anchor',
    name: '日期锚点歧义',
    triggerWhen:
      '用户给了日期但未指明锚点是签单/起保/到期/出险（如续保盯盘按"到期"、签单分析按"签单"，差异很大）',
    askBackTemplate:
      '日期口径未指明：您说的日期是按【签单日】【起保日】【到期日】还是【出险日】？不同锚点对应完全不同的业务问题。',
    relatedTimeWindows: [],
  },
];

/**
 * 给定路由时间口径，拼装应附加到 timeWindowNote / MCP tool description 的反问提示。
 * 无关联触发时返回空串（窗口口径等无歧义，不打扰）。
 */
export function composeAskBackHint(timeWindow: RouteTimeWindow): string {
  const triggers = DISAMBIGUATION_PROTOCOL.filter((t) =>
    t.relatedTimeWindows.includes(timeWindow)
  );
  if (triggers.length === 0) return '';
  return triggers
    .map((t) => `若${t.triggerWhen}，先反问用户：${t.askBackTemplate}`)
    .join(' ');
}
