/**
 * 图表账本静态叙述内容（方法论层，与数据解耦）
 *
 * - 三层框架总览（目标层 / 链路层 / 动作层）
 * - 5 个业务阶段（渠道→承保→理赔→续保→财务）标题与导语
 * - 12 张图卡片的「怎么看 / 口径 / 动作」元数据
 *
 * 「结论先行」的结论句与要点由 useChartLedgerData 依真实数据动态派生，不在此硬编码。
 */
import type { LedgerCardMeta } from './types';

export interface LedgerStage {
  id: string;
  no: string;
  title: string;
  tagline: string;
  /** 该阶段包含的卡片 id 顺序 */
  cardIds: string[];
}

export const FRAMEWORK = {
  goal: {
    title: '目标层',
    desc: '看什么',
    items: [
      '规模 · 保费/件数/客户数',
      '利润 · 赔付率/费用率/综合成本率',
      '风险 · 异常费用/异常赔案',
      '客户 · 续保率/留存/转化',
      '组织 · 节奏与执行',
    ],
  },
  chain: {
    title: '链路层',
    desc: '问题出在哪 — 下文按此展开',
    items: ['01 渠道触达', '02 承保定价', '03 理赔处理', '04 续保复购', '05 财务结果'],
  },
  action: {
    title: '动作层',
    desc: '怎么干',
    items: ['加码 · 复制', '优化 · 整改', '暂停 · 退出', '（每张图卡片右下角标注对应动作）'],
  },
} as const;

export const STAGES: LedgerStage[] = [
  {
    id: 'stage-1',
    no: '01',
    title: '渠道触达',
    tagline: '哪些客群/渠道值得继续投入，哪些规模大但在拉低利润。',
    cardIds: ['chart-01'],
  },
  {
    id: 'stage-2',
    no: '02',
    title: '承保定价',
    tagline: '费用是否真实合规，哪些机构 × 险种组合风险已经偏离正常区间。',
    cardIds: ['chart-02', 'chart-03'],
  },
  {
    id: 'stage-3',
    no: '03',
    title: '理赔处理',
    tagline: '哪些客群案均赔款失控，出险频度是否在恶化，赔款发展是否提速。',
    cardIds: ['chart-04', 'chart-05', 'chart-06'],
  },
  {
    id: 'stage-4',
    no: '04',
    title: '续保复购',
    tagline: '客户在哪个环节流失，续保/转化干预应该卡在哪一步。',
    cardIds: ['chart-07'],
  },
  {
    id: 'stage-5',
    no: '05',
    title: '财务结果',
    tagline: '利润从哪里流失，波动是否正常，该给谁分配责任。',
    cardIds: ['chart-08', 'chart-09', 'chart-10', 'chart-11', 'chart-12'],
  },
];

export const CARD_META: Record<string, LedgerCardMeta> = {
  'chart-01': {
    id: 'chart-01',
    no: '01',
    eyebrow: 'Chart 01 · 关系类',
    name: '客群产能-质量矩阵',
    usage:
      '气泡横轴 = 客群保费规模，纵轴 = 满期赔付率，气泡大小 = 承保件数。右上角是"规模大但质量差"，左下角是"规模小但值得复制"。',
    note: '真实数据 · 客户类别 × 保费/满期赔付率/件数',
    action: '优化',
    actionText: '高赔付客群优化 / 低赔付客群复制经验',
  },
  'chart-02': {
    id: 'chart-02',
    no: '02',
    eyebrow: 'Chart 02 · 关系类 / 异常检测',
    name: '费用率异常散点图',
    usage:
      '横轴 = 费用率，纵轴 = 保费规模。正常机构应聚成一团；远离主群（费用率超出 均值+2σ）的点用珊瑚色标出，是核查重点。',
    note: '真实数据 · 三级机构 × 费用率/保费；异常判定 = 均值±2σ 规则',
    action: '整改',
    actionText: '专项稽核',
  },
  'chart-03': {
    id: 'chart-03',
    no: '03',
    eyebrow: 'Chart 03 · 结构类',
    name: '机构 × 险种风险热力图',
    usage:
      '行 = 三级机构，列 = 险种，格子颜色越偏珊瑚色代表满期赔付率越高。用于快速定位"哪个机构的哪类险种"需要限额承保。',
    note: '真实数据 · 三级机构 × 险种 · 满期赔付率(%)',
    action: '整改',
    actionText: '限额承保 / 提高核保条件',
  },
  'chart-04': {
    id: 'chart-04',
    no: '04',
    eyebrow: 'Chart 04 · 对比类 / 分布',
    name: '案均赔款箱线图',
    usage:
      '箱体 = 客群内各机构案均赔款的中间 50% 区间（Q1-Q3），线 = 中位数，须线两端 = 最小/最大机构。箱体越高、须线越长，说明该客群赔案越不稳定。',
    note: '真实数据 · 客户类别 × 机构案均赔款分布（五数概括为客户端规则派生）',
    action: '整改',
    actionText: '大案复核 / 反欺诈',
  },
  'chart-05': {
    id: 'chart-05',
    no: '05',
    eyebrow: 'Chart 05 · 趋势类',
    name: '出险频度趋势图',
    usage:
      '横轴 = 周次，纵轴 = 满期出险频度。作为理赔成本的先行指标，比赔付率更早反映风险变化——频度先动，赔付率随后跟涨。',
    note: '真实数据 · 周序号 × 满期出险频度(%)',
    action: '预警',
    actionText: '提前介入而非等赔付率恶化',
  },
  'chart-06': {
    id: 'chart-06',
    no: '06',
    eyebrow: 'Chart 06 · 行业专属',
    name: '赔款发展三角图',
    usage:
      '行 = 起保年度（cohort），列 = 发展月（M3/M6/M9…）。只有对角线以上的格子有数据，横向对比同一发展期不同年度的赔付率，判断赔款发展是否在提速。',
    note: '真实数据 · 起保年度 × 发展月 · 累计满期赔付率(%)',
    action: '整改',
    actionText: '复核准备金计提假设',
  },
  'chart-07': {
    id: 'chart-07',
    no: '07',
    eyebrow: 'Chart 07 · 结构类 / 转化',
    name: '报价转化漏斗图',
    usage:
      '每一层宽度代表业务量，层间的收窄幅度就是流失率。找到收窄最陡的那一层，干预动作应该精准卡在那一步，而不是均匀撒资源。',
    note: '真实数据 · 报价转化漏斗 · 各环节业务量',
    action: '整改',
    actionText: '干预聚焦流失最陡环节',
  },
  'chart-08': {
    id: 'chart-08',
    no: '08',
    eyebrow: 'Chart 08 · 行业专属 / 拆解',
    name: '承保利润瀑布图',
    usage:
      '每根柱子代表一次加减，柱高 = 变动金额，柱顶位置 = 累计结果。满期保费依次扣减赔款、费用后落到承保边际——哪根柱子最长，利润就是从哪里流失的。',
    note: '真实数据 · 满期保费 → 赔款 → 费用 → 承保边际（万元）',
    action: '整改',
    actionText: '控赔优先于控费',
  },
  'chart-09': {
    id: 'chart-09',
    no: '09',
    eyebrow: 'Chart 09 · 责任排序',
    name: '机构亏损帕累托图',
    usage:
      '柱状按承保亏损金额从高到低排序，折线是累计占比。找到累计线越过 80% 的那根柱子，其左侧就是需要优先治理的"关键少数"机构。',
    note: '真实数据 · 三级机构 · 承保边际为负者（万元）/ 累计占比(%)',
    action: '整改',
    actionText: '专项治理头部亏损机构',
  },
  'chart-10': {
    id: 'chart-10',
    no: '10',
    eyebrow: 'Chart 10 · 结构类',
    name: '险种结构树图',
    usage:
      '面积 = 保费占比。用于一眼判断业务组合是否过度集中，以及哪些小块业务值得提前布局。',
    note: '真实数据 · 险种保费占比(%)',
    action: '优化',
    actionText: '结构调整：识别压舱石与高风险敞口',
  },
  'chart-11': {
    id: 'chart-11',
    no: '11',
    eyebrow: 'Chart 11 · 趋势类 / 监控',
    name: '变动成本率控制图',
    usage:
      '中心线 CL = 历史均值，UCL/LCL = 上下控制限（CL±2σ）。落在控制限内是"正常波动"；一旦突破，才是真正需要介入的信号——避免把噪音当问题、把问题当噪音。',
    note: '真实数据 · 周序号 × 变动成本率(%)；控制限 = CL±2σ 规则',
    action: '预警',
    actionText: '仅对突破点介入，避免过度反应',
  },
  'chart-12': {
    id: 'chart-12',
    no: '12',
    eyebrow: 'Chart 12 · 关系类 / 决策矩阵',
    name: '赔付率-保费增速四象限图',
    usage:
      '纵轴 = 满期赔付率（阈值 65%），横轴 = 保费同比增速（阈值 = 全省均值）。四象限对应四种动作：右下=优质增长(加码)，右上=风险扩张(整改)，左下=潜力不足(复制)，左上=低效业务(暂停)。',
    note: '真实数据 · 三级机构 · 保费同比增速(%) × 满期赔付率(%)',
    action: '优化',
    actionText: '按象限分类下发四种不同动作',
  },
};

/** 阈值常量（业务口径见 CLAUDE.md §10 / 业务规则字典；此处为展示阈值） */
export const LOSS_RATIO_THRESHOLD = 65; // 满期赔付率四象限/高赔付判定阈值(%)
