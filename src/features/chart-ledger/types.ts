/**
 * 图表账本（保险经营图表方法论）类型定义
 *
 * 页面把「12 类经营图表」按承保业务链路（渠道→承保→理赔→续保→财务）组织，
 * 每张图由真实项目数据驱动（pivot 原子指标 + claims-detail / quote-conversion 域路由），
 * 卡片右下角标注对应经营动作（加码/复制/优化/整改/预警/暂停）。
 */

/** 经营动作枚举（决定动作标签配色语义） */
export type LedgerAction = '加码' | '复制' | '优化' | '整改' | '预警' | '暂停';

/** 单张图表卡片的静态叙述元数据（口径说明与动作，与数据解耦） */
export interface LedgerCardMeta {
  /** 卡片锚点 id（chart-01 … chart-12） */
  id: string;
  /** 序号展示（01…12） */
  no: string;
  /** 眉标（图表分类） */
  eyebrow: string;
  /** 卡片标题 */
  name: string;
  /** 「怎么看」使用说明 */
  usage: string;
  /** 数据口径脚注（维度 × 指标 · 真实数据来源） */
  note: string;
  /** 经营动作 */
  action: LedgerAction;
  /** 动作旁注文案 */
  actionText: string;
}

/** 数据加载态（供卡片渲染空/错/载入态） */
export interface AsyncState {
  loading: boolean;
  error: boolean;
  empty: boolean;
  /** 错误态"重试"回调（由 hook 用 React Query refetch 装配） */
  retry?: () => void;
}

/** 气泡/散点单点 */
export interface PointDatum {
  name: string;
  x: number;
  y: number;
  r?: number;
  outlier?: boolean;
}

/** 箱线图单类的五数概括 */
export interface BoxDatum {
  name: string;
  min: number;
  q1: number;
  med: number;
  q3: number;
  max: number;
}

/** 漏斗单层 */
export interface FunnelStep {
  name: string;
  value: number;
}

/** 树图单块 */
export interface TreemapCell {
  name: string;
  value: number;
  share: number;
}

/** 帕累托单条 */
export interface ParetoBar {
  name: string;
  value: number;
  cumPct: number;
}

/** 单张图的整形结果 = 状态 + 动态结论 + 数据载荷 */
export interface ChartResult<T> extends AsyncState {
  /** 由真实数据派生的一句话结论（结论先行） */
  conclusion: string;
  /** 由真实数据派生的 2-3 条要点 */
  points: string[];
  data: T;
}
