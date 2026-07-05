/**
 * 图表账本 · 12 张读图指南内容定义（文案 SSOT）
 *
 * 结构：① 回答什么 ② 解剖图+图注 ③ 读图三步 ④ 判定规则 ⑤ 决策映射。
 * 只讲图的方法论，不复述实时数据；阈值口径指向 ledgerMeta.LOSS_RATIO_THRESHOLD
 * 与 useChartLedgerData 内的客户端规则（均值±2σ / 五数概括 / 步进转化）。
 */
import { LOSS_RATIO_THRESHOLD } from '../ledgerMeta';
import type { InfographDef } from './types';
import { AnatomyChannelMatrix, AnatomyFeeOutlier, AnatomyHeatmap } from './anatomies/AnatomyCharts0103';
import { AnatomyBoxplot, AnatomyFrequency, AnatomyTriangle } from './anatomies/AnatomyCharts0406';
import { AnatomyFunnel, AnatomyWaterfall, AnatomyPareto } from './anatomies/AnatomyCharts0709';
import { AnatomyTreemap, AnatomyControl, AnatomyQuadrant } from './anatomies/AnatomyCharts1012';

const LR = `${LOSS_RATIO_THRESHOLD}%`;

export const INFOGRAPHS: Record<string, InfographDef> = {
  'chart-01': {
    id: 'chart-01',
    question: '哪些客群规模大却在拉低利润，哪些客群小而优值得复制？',
    anatomy: AnatomyChannelMatrix,
    anatomyNotes: [
      '气泡大小 = 承保件数（规模的第二维度：保费大但件数少 = 高件均结构）',
      `颜色即判定：赔付率 ≥ ${LR} 珊瑚描边，< ${LR} 青色描边`,
    ],
    steps: [
      `先看 ${LR} 金线上方有哪些客群（质量不达标名单）`,
      '再看线上方谁的气泡最大（对整体拖累最大，优先处置）',
      '最后看左下角小而优的客群，提炼可复制的承保经验',
    ],
    rules: [
      { label: `赔付率阈值 ${LR}`, desc: '展示阈值（SSOT：ledgerMeta.LOSS_RATIO_THRESHOLD），非监管红线；结合当期成本水平灵活解读' },
      { label: '满期口径', desc: '纵轴是满期赔付率（已发生赔款 ÷ 满期保费），未满期业务天然偏低，新业务解读要留成熟度余量' },
    ],
    decisions: [
      { signal: '右上角有大气泡（规模大 · 质量差）', action: '优化', move: '客群定价/核保政策优化，必要时限增速' },
      { signal: '左下角有小气泡（规模小 · 质量好）', action: '复制', move: '提炼渠道与核保经验，放量复制' },
      { signal: '右下角压舱石客群', action: '加码', move: '守住基本盘，资源优先保障' },
    ],
  },
  'chart-02': {
    id: 'chart-02',
    question: '哪些机构的费用率显著偏离大部队，需要核实费用真实性？',
    anatomy: AnatomyFeeOutlier,
    anatomyNotes: [
      '主群 = 大多数机构聚成的一团（正常费用率区间）',
      '离群点用菱形放大标注——形状 + 颜色双编码，色盲也能扫到',
    ],
    steps: [
      '先看主群聚在什么费用率水平（这是全省的"正常"基准）',
      '再看 均值+2σ 参考线右侧有没有点',
      '对离群点先核实费用结构与报销单据，再定性——离群 ≠ 违规',
    ],
    rules: [
      { label: '离群判定 = 均值 + 2σ', desc: '对全体机构费用率算均值与标准差，超出均值+2倍标准差视为统计离群' },
      { label: '小样本熔断', desc: '样本不足 5 家时统计量不稳定，自动放弃离群判定（图上会说明）' },
    ],
    decisions: [
      { signal: '有机构落在 均值+2σ 右侧', action: '整改', move: '专项稽核该机构费用报销与手续费结构' },
      { signal: '主群整体右移（均值抬升）', action: '预警', move: '费用政策全省复盘，而非追个别机构' },
    ],
  },
  'chart-03': {
    id: 'chart-03',
    question: '哪个机构的哪类险种赔付率异常，需要限额承保或收紧核保？',
    anatomy: AnatomyHeatmap,
    anatomyNotes: [
      `颜色梯度：青色（约 50%）→ 珊瑚色（约 95%），越红越差（与散点/三角同一色标）`,
      '默认取行内最高赔付率靠前的机构，避免超长表',
    ],
    steps: [
      '先扫全表最红的格子（最高风险组合）',
      '看该格所在的整行与整列：整行红 = 机构性问题；整列红 = 险种性问题',
      '行列交叉定位后，把动作下到"机构 × 险种"粒度，不搞一刀切',
    ],
    rules: [
      { label: '色标 50→95 映射', desc: '同一 lossRatioColor 梯度贯穿热力图/发展三角，跨图颜色语义一致' },
      { label: '空格 = 无业务', desc: '不是零风险，是该组合无承保数据' },
    ],
    decisions: [
      { signal: '单格深红', action: '整改', move: '该机构该险种限额承保 / 提高核保条件' },
      { signal: '整行偏红', action: '整改', move: '机构级核保权限收紧 + 业务结构复盘' },
      { signal: '整列偏红', action: '预警', move: '险种级定价问题上报分公司产品线' },
    ],
  },
  'chart-04': {
    id: 'chart-04',
    question: '哪个客群的案均赔款不稳定，长尾大案风险藏在哪里？',
    anatomy: AnatomyBoxplot,
    anatomyNotes: [
      '一个箱 = 一个客群；箱内样本 = 该客群下各机构的案均赔款',
      '中位数用金线（不是均值——均值会被大案拉飞，中位数抗离群）',
    ],
    steps: [
      '先横向比各客群的金线高度（典型案均水平）',
      '再比箱体高度：箱越高，机构间差异越大，管理越不齐',
      '重点看上须长度：上须特别长 = 存在案均远超同侪的机构，藏着长尾大案',
    ],
    rules: [
      { label: '五数概括', desc: '最小 / Q1 / 中位数 / Q3 / 最大，客户端按线性插值分位数计算' },
      { label: '样本门槛', desc: '客群内机构数 ≥ 3 才出箱（不足时分布无意义）；默认取极差最大的前 5 个客群' },
    ],
    decisions: [
      { signal: '某客群上须极长', action: '整改', move: '定位须端机构做大案复核 / 反欺诈排查' },
      { signal: '整箱位置偏高', action: '优化', move: '该客群定价与理赔管控整体复审' },
    ],
  },
  'chart-05': {
    id: 'chart-05',
    question: '风险是否正在恶化？（不等赔付率跟涨就要知道）',
    anatomy: AnatomyFrequency,
    anatomyNotes: [
      '出险频度是赔付率的先行指标：频度先动，赔付率因赔款结案滞后随后跟涨',
      '分母是已赚暴露（满期口径），不是签单件数',
    ],
    steps: [
      '先看最近 3 周的方向（抬头 / 走平 / 回落）',
      '再与起始周比较水平（趋势幅度）',
      '频度连续抬头即触发预警——这正是提前介入的时间窗',
    ],
    rules: [
      { label: '满期出险频度', desc: '出险件数 ÷ 已赚暴露，年化处理；未满期业务直接数件数会失真' },
      { label: '领先 2–3 周', desc: '经验滞后量：频度拐点通常领先赔付率拐点 2–3 周（示意值，随结案速度浮动）' },
    ],
    decisions: [
      { signal: '频度连续 2-3 周上行', action: '预警', move: '提前收紧高风险客群核保，不等赔付率恶化' },
      { signal: '频度回落但赔付率仍在涨', action: '优化', move: '属存量赔案结案节奏问题，转理赔端提速处理' },
    ],
  },
  'chart-06': {
    id: 'chart-06',
    question: '新年度保单的赔款发展是否比老年度更快（准备金是否够）？',
    anatomy: AnatomyTriangle,
    anatomyNotes: [
      '行 = 起保年度（同一年起保的保单批次）；列 = 发展期（起保后满 N 月）',
      '只有对角线以内有数据：越新的年度能观察到的发展期越短',
    ],
    steps: [
      '竖着比同一列：同一发展期（同成熟度）不同年度才可比',
      '若新年度在同列明显高于老年度 → 赔款发展在提速',
      '禁止横着比不同列——成熟度不同，数字天然递增，比了也是错',
    ],
    rules: [
      { label: '同列可比原则', desc: '满 6 月只能和满 6 月比；跨列比较是发展三角最常见的误读' },
      { label: '累计口径', desc: '格内是该批次到该发展期的累计满期赔付率' },
    ],
    decisions: [
      { signal: '新年度同列系统性走高', action: '整改', move: '复核准备金计提假设，必要时上调' },
      { signal: '需要定位提速来源', action: '优化', move: '转赔付率发展诊断（多维下钻）深查客群/险种' },
    ],
  },
  'chart-07': {
    id: 'chart-07',
    question: '客户在报价到承保的哪一步流失最多，干预该卡在哪里？',
    anatomy: AnatomyFunnel,
    anatomyNotes: [
      '四层：全部报价 → 有效报价 → 优质报价 → 已承保；层宽 = 业务量',
      '收窄幅度 = 该环节流失率，宽度骤减处就是问题环节',
    ],
    steps: [
      '找收窄最陡的一层（流失主战场）',
      '算该层步进转化率，与自身历史或同侪比（判断是恶化还是常态）',
      '干预动作精准卡在那一步——资源不平均撒',
    ],
    rules: [
      { label: '步进转化率', desc: '本层量 ÷ 上一层量；整体转化率 = 各层步进连乘，改善最陡层收益最大' },
      { label: '分层口径', desc: '有效/优质报价的判定标准以报价转化域的业务定义为准' },
    ],
    decisions: [
      { signal: '有效 → 优质收窄最陡', action: '整改', move: '报价质量治理（信息完整度 / 报价跟进时效）' },
      { signal: '优质 → 承保收窄最陡', action: '优化', move: '价格竞争力与承保政策核查' },
    ],
  },
  'chart-08': {
    id: 'chart-08',
    question: '利润到底是从赔款还是费用流失的，承保还挣不挣钱？',
    anatomy: AnatomyWaterfall,
    anatomyNotes: [
      '首柱 = 满期保费（利润的来源）；红柱 = 依次扣减；尾柱 = 承保边际（落袋结果）',
      '柱顶位置 = 扣减后的累计结果，虚线连接可直接读出中间余额',
    ],
    steps: [
      '先看尾柱（承保边际）是正是负',
      '再比两根红柱谁长——最长的红柱就是利润流失主因',
      '把长柱换算成率值（赔付率/费用率）与阈值对照，确认恶化幅度',
    ],
    rules: [
      { label: '赔款拆解', desc: '赔款 = Σ(满期保费 × 满期赔付率)；费用及其他 = 综合成本 − 赔款（余项口径）' },
      { label: '满期口径', desc: '全链条用满期保费为基准，与签单口径的规模数不可直接互比' },
    ],
    decisions: [
      { signal: '赔款柱明显长于费用柱', action: '整改', move: '控赔优先：核保收紧 + 理赔管控' },
      { signal: '费用柱异常偏长', action: '优化', move: '费用结构治理（获取成本 / 手续费）' },
      { signal: '尾柱为负', action: '预警', move: '承保亏损：止损组合拳（限额 + 提价 + 结构调整）' },
    ],
  },
  'chart-09': {
    id: 'chart-09',
    question: '承保亏损集中在哪几家机构，先治理谁性价比最高？',
    anatomy: AnatomyPareto,
    anatomyNotes: [
      '柱 = 亏损金额从高到低排序；金线 = 亏损累计占比',
      '累计线越过 80% 的位置把机构切成"关键少数 / 长尾"两段',
    ],
    steps: [
      '找累计金线越过 80% 的那根柱子',
      '其左侧机构 = 关键少数，优先投入治理资源',
      '右侧长尾机构常规管理即可——不平均用力',
    ],
    rules: [
      { label: '入选口径', desc: '只统计承保边际为负（亏损）的机构，按亏损绝对额排序' },
      { label: '80/20 参考', desc: '80% 是帕累托经验参考线，不是业务红线；集中度越高，专项治理收益越大' },
    ],
    decisions: [
      { signal: '前 3 家贡献大部分亏损', action: '整改', move: '逐家出专项治理方案（结构 + 定价 + 理赔）' },
      { signal: '第 1 家独占过半亏损', action: '预警', move: '单点攻坚，分公司挂牌督办' },
    ],
  },
  'chart-10': {
    id: 'chart-10',
    question: '业务组合是否过度集中，高风险险种占了多大盘子？',
    anatomy: AnatomyTreemap,
    anatomyNotes: [
      '面积 = 保费占比；大块是收入压舱石，也是集中度风险所在',
      '结合赔付率看：高赔付险种若占大块面积，就是组合的风险敞口',
    ],
    steps: [
      '看最大块占比：单一险种独大 = 组合脆弱',
      '把高赔付险种的面积框出来（风险敞口有多大）',
      '在小块里找值得提前布局的机会业务',
    ],
    rules: [
      { label: '占比口径', desc: '该险种保费 ÷ 当前筛选下总保费（签单口径）' },
    ],
    decisions: [
      { signal: '单一险种占比过高', action: '优化', move: '结构调整：扶持第二增长险种' },
      { signal: '高赔付险种面积大', action: '整改', move: '该险种限额 / 提价 / 分保安排' },
      { signal: '小块中有优质增量', action: '加码', move: '提前布局，抢占份额' },
    ],
  },
  'chart-11': {
    id: 'chart-11',
    question: '本周成本波动是正常噪音还是真异常，值不值得兴师动众？',
    anatomy: AnatomyControl,
    anatomyNotes: [
      '三线：中心线 = 历史均值；上 / 下控制限 = 中心线 ± 2σ',
      '限内波动是系统固有噪音——对噪音做动作本身就是浪费',
    ],
    steps: [
      '先看有没有点突破控制限（唯一需要立即行动的信号）',
      '有破限点：定位周次，找对应事件（大案 / 政策 / 灾害天气）',
      '无破限但连续多周同侧漂移：属系统性变化，安排复盘而非救火',
    ],
    rules: [
      { label: '控制限 = 均值 ± 2σ', desc: '按当前窗口内周度数据计算；窗口变了控制限跟着变' },
      { label: '两类错误', desc: '把噪音当问题 = 过度反应；把问题当噪音 = 反应迟钝。控制图就是划这条线的' },
    ],
    decisions: [
      { signal: '单点破上限', action: '预警', move: '仅对破限周定点介入，查一次性事件' },
      { signal: '连续 5+ 周同侧漂移', action: '优化', move: '系统性变化：复盘定价 / 费用政策' },
    ],
  },
  'chart-12': {
    id: 'chart-12',
    question: '每家机构该加码、整改、复制还是暂停？一张图分完。',
    anatomy: AnatomyQuadrant,
    anatomyNotes: [
      `十字线：横 = 满期赔付率 ${LR}；纵 = 保费增速均值（随当前筛选动态计算）`,
      '四象限四色四动作，与全页动作标签同一套颜色 + 形状编码',
    ],
    steps: [
      '先看右上（风险扩张）：增长正在放大风险，最危险',
      '再看右下（优质增长）：又快又好，资源向这里倾斜',
      '按象限批量下发差异化动作，避免"一套政策管全省"',
    ],
    rules: [
      { label: `纵轴阈值 ${LR}`, desc: '与 01 气泡矩阵同一展示阈值（SSOT ledgerMeta）' },
      { label: '横轴阈值 = 增速均值', desc: '动态基准：全省均值随筛选范围变化，象限归属会随之移动' },
    ],
    decisions: [
      { signal: '右下 · 优质增长', action: '加码', move: '资源倾斜，扩大授权' },
      { signal: '右上 · 风险扩张', action: '整改', move: '控增速 + 调结构，先质后量' },
      { signal: '左下 · 潜力不足', action: '复制', move: '质量好没长大：导入优质增长机构的经验' },
      { signal: '左上 · 低效业务', action: '暂停', move: '限期改善，无改善则收缩退出' },
    ],
  },
};
