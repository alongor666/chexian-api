/**
 * 图表账本数据装配 Hook
 *
 * 用 12 张图所需的 ~10 个真实查询（pivot 原子指标 + claims-detail 发展三角 +
 * quote-conversion 漏斗 + performance 机构增速）驱动整页，逐图整形为 ChartResult：
 * 状态（loading/error/empty）+ 由真实数据派生的「结论先行」结论句与要点 + 图表载荷。
 *
 * 口径说明：所有金额指标单位为「元」，展示层统一 ÷1e4 转「万元」；比率指标单位为「%」。
 * 异常/控制限/五数概括等「规则」在客户端计算（原始 HTML 的静态 mock 在此以真实数据补齐）。
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { useGlobalFilters } from '@/shared/contexts/FilterContext';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { formatPremiumWan, formatPercent } from '@/shared/utils/formatters';
import { LOSS_RATIO_THRESHOLD } from '../ledgerMeta';
import type {
  BoxDatum,
  ChartResult,
  FunnelStep,
  ParetoBar,
  PointDatum,
  TreemapCell,
} from '../types';

// ─── 数值/统计工具 ──────────────────────────────────────────
const num = (v: unknown): number => {
  const n = typeof v === 'bigint' ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const wan = (yuan: number): number => yuan / 1e4;
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const std = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
/** 线性插值分位数 */
const quantile = (sortedAsc: number[], p: number): number => {
  if (sortedAsc.length === 0) return NaN;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
};

/** 非成功态（载入/错/空）时的结论与要点占位；loading/error/empty 由各图真实状态提供 */
const EMPTY_STATE = { conclusion: '', points: [] as string[] };

function state(q: { isLoading: boolean; isError: boolean }, empty: boolean) {
  return { loading: q.isLoading, error: q.isError, empty: !q.isLoading && !q.isError && empty };
}

// ─── Hook ───────────────────────────────────────────────────
export function useChartLedgerData() {
  const { filters } = useGlobalFilters();
  const params = useMemo(() => buildFilterParams(filters), [filters]);
  const claimsParams = useMemo(() => {
    const p: Record<string, string> = {};
    if (params.orgNames) p.orgName = params.orgNames;
    if (params.startDate) p.dateStart = params.startDate;
    if (params.endDate) p.dateEnd = params.endDate;
    return p;
  }, [params]);
  // quote-conversion 域自治参数集（dateStart/dateEnd + orgName），与 claimsParams 同理：
  // 若直传全局 params（startDate/endDate/dateField=policy_date），会被路由共享的
  // parseFiltersAndBuildWhere 识别为「按 policy_date 过滤」注入 WHERE 子句，但
  // QuoteConversion 表没有 policy_date 列 → Binder Error 500（quote-conversion 自身
  // 日期过滤走 dateStart/dateEnd，其 parseFilters 不识别 startDate/endDate，不会误注入）。
  const funnelParams = useMemo(() => {
    const p: Record<string, string> = {};
    if (params.orgNames) p.orgName = params.orgNames;
    if (params.startDate) p.dateStart = params.startDate;
    if (params.endDate) p.dateEnd = params.endDate;
    return p;
  }, [params]);

  const keyBase = JSON.stringify(params);

  // ── 真实查询（每查询独立错误隔离，单图失败不拖垮整页） ──
  const qOrg = useQuery({
    queryKey: ['ledger', 'org', keyBase],
    queryFn: () =>
      apiClient.getPivot(
        ['org_level_3'],
        ['total_premium', 'expense_ratio', 'earned_claim_ratio', 'earned_margin_amount', 'policy_count'],
        params,
        500
      ),
  });
  const qCust = useQuery({
    queryKey: ['ledger', 'cust', keyBase],
    queryFn: () =>
      apiClient.getPivot(['customer_category'], ['total_premium', 'earned_claim_ratio', 'policy_count'], params, 100),
  });
  const qHeatmap = useQuery({
    queryKey: ['ledger', 'heatmap', keyBase],
    queryFn: () => apiClient.getPivot(['org_level_3', 'insurance_type'], ['earned_claim_ratio'], params, 500),
  });
  const qBox = useQuery({
    queryKey: ['ledger', 'box', keyBase],
    queryFn: () =>
      apiClient.getPivot(['customer_category', 'org_level_3'], ['avg_claim_amount', 'policy_count'], params, 500),
  });
  const qWeek = useQuery({
    queryKey: ['ledger', 'week', keyBase],
    queryFn: () => apiClient.getPivot(['week_number'], ['earned_loss_frequency', 'variable_cost_ratio'], params, 100),
  });
  const qInsType = useQuery({
    queryKey: ['ledger', 'instype', keyBase],
    queryFn: () => apiClient.getPivot(['insurance_type'], ['total_premium', 'earned_claim_ratio'], params, 100),
  });
  const qWaterfall = useQuery({
    queryKey: ['ledger', 'waterfall', keyBase],
    queryFn: () =>
      apiClient.getPivot(
        ['is_nev'],
        ['earned_premium', 'earned_margin_amount', 'earned_claim_ratio', 'expense_ratio'],
        params,
        10
      ),
  });
  const qTriangle = useQuery({
    queryKey: ['ledger', 'triangle', keyBase],
    queryFn: () => apiClient.claimsDetail.lossRatioDev(claimsParams),
  });
  const qFunnel = useQuery({
    queryKey: ['ledger', 'funnel', keyBase],
    queryFn: () => apiClient.quoteConversion.funnel(funnelParams),
  });
  const qGrowth = useQuery({
    queryKey: ['ledger', 'growth', keyBase],
    queryFn: () => apiClient.performance.orgHeatmap(params),
  });

  // ── Chart 01 客群产能-质量矩阵（气泡） ──
  const chart01: ChartResult<PointDatum[]> = useMemo(() => {
    const rows = qCust.data?.rows ?? [];
    const pts: PointDatum[] = rows
      .map((r) => ({
        name: String(r.customer_category ?? '未知'),
        x: wan(num(r.total_premium)),
        y: num(r.earned_claim_ratio),
        r: num(r.policy_count),
      }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    const s = state(qCust, pts.length === 0);
    if (s.loading || s.error || s.empty) return { ...s, ...EMPTY_STATE, data: pts };
    const worst = [...pts].sort((a, b) => b.y - a.y)[0];
    const biggest = [...pts].sort((a, b) => b.x - a.x)[0];
    return {
      ...s,
      data: pts,
      conclusion: `${worst.name}满期赔付率 ${formatPercent(worst.y)} 为各客群最高；规模最大的是 ${biggest.name}（${formatPremiumWan(biggest.x * 1e4)}万）。`,
      points: [
        `规模最大：${biggest.name}，保费 ${formatPremiumWan(biggest.x * 1e4)}万，赔付率 ${formatPercent(biggest.y)}`,
        `质量最差：${worst.name}，赔付率 ${formatPercent(worst.y)}`,
        `共 ${pts.length} 个客群纳入产能-质量对照`,
      ],
    };
  }, [qCust.data, qCust.isLoading, qCust.isError]);

  // ── Chart 02 费用率异常散点（均值±2σ 规则） ──
  const chart02: ChartResult<PointDatum[]> = useMemo(() => {
    const rows = qOrg.data?.rows ?? [];
    const base = rows
      .map((r) => ({ name: String(r.org_level_3 ?? '未知'), x: num(r.expense_ratio), y: wan(num(r.total_premium)) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    // 机构数过少时均值±2σ 统计量本身不稳定，禁用离群点判定（与 chart04 箱线图 xs.length>=3 门槛一致的保守做法）
    const MIN_SAMPLE = 5;
    const enoughSample = base.length >= MIN_SAMPLE;
    const m = mean(base.map((p) => p.x));
    const sd = std(base.map((p) => p.x));
    const hi = m + 2 * sd;
    const pts: PointDatum[] = base.map((p) => ({ ...p, outlier: enoughSample && p.x > hi }));
    const s = state(qOrg, pts.length === 0);
    if (s.loading || s.error || s.empty) return { ...s, ...EMPTY_STATE, data: pts };
    const outliers = pts.filter((p) => p.outlier).sort((a, b) => b.x - a.x);
    return {
      ...s,
      data: pts,
      conclusion: !enoughSample
        ? `样本机构仅 ${pts.length} 家，不足 ${MIN_SAMPLE} 家，暂不做统计离群点判定。`
        : outliers.length
        ? `${outliers.length} 家机构费用率显著偏离主群（超 均值+2σ = ${formatPercent(hi)}），建议核实费用报销合理性（离群不等于违规，需人工复核）。`
        : `全部 ${pts.length} 家机构费用率聚集在 均值±2σ 内，未见显著异常点。`,
      points: [
        `主群费用率均值 ${formatPercent(m)}，标准差 ${formatPercent(sd)}`,
        enoughSample ? `离群参考上限（均值+2σ）= ${formatPercent(hi)}` : `机构数不足 ${MIN_SAMPLE} 家，离群上限仅供参考`,
        ...outliers.slice(0, 2).map((o) => `${o.name}：费用率 ${formatPercent(o.x)}，保费 ${formatPremiumWan(o.y * 1e4)}万 —— 建议核实`),
      ],
    };
  }, [qOrg.data, qOrg.isLoading, qOrg.isError]);

  // ── Chart 03 机构×险种风险热力图 ──
  const chart03 = useMemo(() => {
    const rows = qHeatmap.data?.rows ?? [];
    const orgs: string[] = [];
    const lines: string[] = [];
    const cell = new Map<string, number>();
    rows.forEach((r) => {
      const org = String(r.org_level_3 ?? '未知');
      const line = String(r.insurance_type ?? '未知');
      const v = num(r.earned_claim_ratio);
      if (!orgs.includes(org)) orgs.push(org);
      if (!lines.includes(line)) lines.push(line);
      if (Number.isFinite(v)) cell.set(`${org}|${line}`, v);
    });
    // 仅取赔付率最高的前 8 家机构，避免超表
    const orgMax = orgs.map((o) => ({ o, max: Math.max(...lines.map((l) => cell.get(`${o}|${l}`) ?? -Infinity)) }));
    const topOrgs = orgMax.filter((x) => Number.isFinite(x.max)).sort((a, b) => b.max - a.max).slice(0, 8).map((x) => x.o);
    const s = state(qHeatmap, topOrgs.length === 0 || lines.length === 0);
    const data = { orgs: topOrgs, lines, cell };
    if (s.loading || s.error || s.empty) return { ...s, ...EMPTY_STATE, data };
    // 找全表最高格
    let hotOrg = '', hotLine = '', hotVal = -Infinity;
    topOrgs.forEach((o) => lines.forEach((l) => {
      const v = cell.get(`${o}|${l}`);
      if (v !== undefined && v > hotVal) { hotVal = v; hotOrg = o; hotLine = l; }
    }));
    return {
      ...s,
      data,
      conclusion: `${hotOrg} × ${hotLine} 满期赔付率 ${formatPercent(hotVal)}，为机构-险种组合中最高，建议限额承保。`,
      points: [
        `热力图覆盖 ${topOrgs.length} 家高赔付机构 × ${lines.length} 个险种`,
        `最高风险格：${hotOrg} × ${hotLine} = ${formatPercent(hotVal)}`,
        `颜色越偏珊瑚色代表赔付率越高`,
      ],
    };
  }, [qHeatmap.data, qHeatmap.isLoading, qHeatmap.isError]);

  // ── Chart 04 案均赔款箱线图（客群内机构分布的五数概括） ──
  const chart04: ChartResult<BoxDatum[]> = useMemo(() => {
    const rows = qBox.data?.rows ?? [];
    const byCat = new Map<string, number[]>();
    rows.forEach((r) => {
      const cat = String(r.customer_category ?? '未知');
      const v = wan(num(r.avg_claim_amount));
      if (Number.isFinite(v) && v > 0) {
        if (!byCat.has(cat)) byCat.set(cat, []);
        byCat.get(cat)!.push(v);
      }
    });
    const boxes: BoxDatum[] = [...byCat.entries()]
      .filter(([, xs]) => xs.length >= 3)
      .map(([name, xs]) => {
        const sorted = [...xs].sort((a, b) => a - b);
        return {
          name,
          min: sorted[0],
          q1: quantile(sorted, 0.25),
          med: quantile(sorted, 0.5),
          q3: quantile(sorted, 0.75),
          max: sorted[sorted.length - 1],
        };
      })
      .sort((a, b) => b.max - a.max)
      .slice(0, 5);
    const s = state(qBox, boxes.length === 0);
    if (s.loading || s.error || s.empty) return { ...s, ...EMPTY_STATE, data: boxes };
    const widest = [...boxes].sort((a, b) => b.max - b.min - (a.max - a.min))[0];
    return {
      ...s,
      data: boxes,
      conclusion: `${widest.name}案均赔款离散度最高（${widest.min.toFixed(1)}–${widest.max.toFixed(1)}万），长尾赔案是主要风险来源。`,
      points: [
        `${widest.name}：中位数 ${widest.med.toFixed(1)}万，最大 ${widest.max.toFixed(1)}万 —— 长尾最明显`,
        `箱体 = 客群内各机构案均赔款 Q1–Q3 区间`,
        `共 ${boxes.length} 个客群参与分布对照（机构数≥3）`,
      ],
    };
  }, [qBox.data, qBox.isLoading, qBox.isError]);

  // ── Chart 05 出险频度趋势 ──
  const chart05 = useMemo(() => {
    const rows = [...(qWeek.data?.rows ?? [])].sort((a, b) => num(a.week_number) - num(b.week_number));
    const labels = rows.map((r) => `W${num(r.week_number)}`);
    const freq = rows.map((r) => num(r.earned_loss_frequency));
    const s = state(qWeek, freq.filter(Number.isFinite).length === 0);
    const data = { labels, freq };
    if (s.loading || s.error || s.empty) return { ...s, ...EMPTY_STATE, data };
    const first = freq.find(Number.isFinite) ?? 0;
    const last = [...freq].reverse().find(Number.isFinite) ?? 0;
    const trend = last > first ? '爬升' : last < first ? '回落' : '走平';
    return {
      ...s,
      data,
      conclusion: `近 ${freq.length} 周出险频度从 ${formatPercent(first)} ${trend}至 ${formatPercent(last)}，作为赔付率先行指标需提前介入。`,
      points: [
        `最新周出险频度 ${formatPercent(last)}`,
        `起始周 ${formatPercent(first)}，整体${trend}`,
        `频度拐点通常领先赔付率变化 2–3 周`,
      ],
    };
  }, [qWeek.data, qWeek.isLoading, qWeek.isError]);

  // ── Chart 06 赔款发展三角 ──
  const chart06 = useMemo(() => {
    const rows = (qTriangle.data ?? []) as Array<Record<string, unknown>>;
    // 容错识别 cohort / dev / 赔付率 字段
    const cohortKey = ['cohort_year', 'accident_year', 'year'].find((k) => rows[0] && k in rows[0]);
    const devKey = ['dev_month', 'development_month', 'maturity', 'month'].find((k) => rows[0] && k in rows[0]);
    // loss_ratio_pct 是 claims-detail/loss-ratio-development 的真实返回字段名
    // （server/src/sql/claims-detail.ts 的 generateLossRatioDevelopmentQuery SELECT 别名）；
    // 其余候选保留作未来口径变更时的兼容兜底。
    const ratioKey = [
      'loss_ratio_pct',
      'loss_ratio',
      'claim_ratio',
      'earned_claim_ratio',
      'cumulative_loss_ratio',
      'ratio',
    ].find((k) => rows[0] && k in rows[0]);
    const years: string[] = [];
    const devs: number[] = [];
    const cell = new Map<string, number>();
    if (cohortKey && devKey && ratioKey) {
      rows.forEach((r) => {
        const y = String(r[cohortKey]);
        const d = num(r[devKey]);
        const v = num(r[ratioKey]);
        if (!years.includes(y)) years.push(y);
        if (!devs.includes(d)) devs.push(d);
        if (Number.isFinite(v)) cell.set(`${y}|${d}`, v);
      });
    }
    years.sort();
    devs.sort((a, b) => a - b);
    const s = state(qTriangle, !cohortKey || years.length === 0 || devs.length === 0);
    const data = { years, devs, cell };
    if (s.loading || s.error || s.empty) return { ...s, ...EMPTY_STATE, data };
    const latestYear = years[years.length - 1];
    const firstDev = devs[0];
    const latestVal = cell.get(`${latestYear}|${firstDev}`);
    return {
      ...s,
      data,
      conclusion: latestVal !== undefined
        ? `${latestYear} 起保年度 M${firstDev} 累计赔付率 ${formatPercent(latestVal)}，横向对比同期年度判断发展是否提速。`
        : `赔款发展三角覆盖 ${years.length} 个起保年度 × ${devs.length} 个发展期。`,
      points: [
        `覆盖起保年度：${years.join(' / ')}`,
        `发展期：${devs.map((d) => `M${d}`).join(' / ')}`,
        `仅对角线以上有数据（未来尚未发生）`,
      ],
    };
  }, [qTriangle.data, qTriangle.isLoading, qTriangle.isError]);

  // ── Chart 07 报价转化漏斗 ──
  const chart07: ChartResult<FunnelStep[]> = useMemo(() => {
    const rows = (qFunnel.data ?? []) as Array<Record<string, unknown>>;
    // quote-conversion/funnel 真实返回是按 renewal_status 分组的宽表
    // （l1_total/l2_valid/l3_quality/l4_insured 四个数值列），不是"阶段名+数值"窄表
    // （见 server/src/sql/quote-conversion.ts generateQuoteFunnelQuery）。
    // 汇总各 renewal_status 分组得到整体转化漏斗四步。
    const STAGE_COLS = ['l1_total', 'l2_valid', 'l3_quality', 'l4_insured'] as const;
    const sums: Record<(typeof STAGE_COLS)[number], number> = {
      l1_total: 0,
      l2_valid: 0,
      l3_quality: 0,
      l4_insured: 0,
    };
    const hasFunnelCols = rows.length > 0 && STAGE_COLS.every((k) => k in rows[0]);
    if (hasFunnelCols) {
      rows.forEach((r) => {
        STAGE_COLS.forEach((k) => {
          const v = num(r[k]);
          if (Number.isFinite(v)) sums[k] += v;
        });
      });
    }
    const steps: FunnelStep[] = hasFunnelCols
      ? [
          { name: '全部报价', value: sums.l1_total },
          { name: '有效报价', value: sums.l2_valid },
          { name: '优质报价', value: sums.l3_quality },
          { name: '已承保', value: sums.l4_insured },
        ]
      : [];
    const s = state(qFunnel, steps.length === 0);
    if (s.loading || s.error || s.empty) return { ...s, ...EMPTY_STATE, data: steps };
    // 找收窄最陡的一层
    let worstIdx = 1, worstDrop = 1;
    for (let i = 1; i < steps.length; i++) {
      const rate = steps[i - 1].value ? steps[i].value / steps[i - 1].value : 1;
      if (1 - rate > worstDrop || i === 1) { worstDrop = 1 - rate; worstIdx = i; }
    }
    const worst = steps[worstIdx];
    return {
      ...s,
      data: steps,
      conclusion: worst
        ? `从"${steps[worstIdx - 1].name}"到"${worst.name}"流失最陡（${formatPercent(worstDrop * 100)}），干预应精准卡在这一步。`
        : `报价转化漏斗共 ${steps.length} 层。`,
      points: steps.slice(0, 4).map((st, i) =>
        i === 0
          ? `${st.name}：${st.value.toLocaleString()}`
          : `${st.name}：${st.value.toLocaleString()}（较上一步 ${formatPercent((st.value / (steps[i - 1].value || 1)) * 100)}）`
      ),
    };
  }, [qFunnel.data, qFunnel.isLoading, qFunnel.isError]);

  // ── Chart 08 承保利润瀑布 ──
  const chart08 = useMemo(() => {
    const rows = qWaterfall.data?.rows ?? [];
    let P = 0, M = 0, claim = 0;
    rows.forEach((r) => {
      const ep = num(r.earned_premium);
      const mg = num(r.earned_margin_amount);
      const cr = num(r.earned_claim_ratio);
      if (Number.isFinite(ep)) P += ep;
      if (Number.isFinite(mg)) M += mg;
      if (Number.isFinite(ep) && Number.isFinite(cr)) claim += (ep * cr) / 100;
    });
    const cost = P - M; // 综合成本 = 满期保费 − 承保边际
    const expenseOther = cost - claim; // 费用及其他成本
    const steps = [
      { label: '满期保费', value: wan(P) },
      { label: '赔款', value: -wan(claim) },
      { label: '费用及其他', value: -wan(expenseOther) },
    ];
    const marginWan = wan(M);
    const s = state(qWaterfall, P === 0);
    const data = { steps, marginWan };
    if (s.loading || s.error || s.empty) return { ...s, ...EMPTY_STATE, data };
    const marginRate = P ? (M / P) * 100 : 0;
    return {
      ...s,
      data,
      conclusion: `满期保费 ${formatPremiumWan(P)}万，扣赔款与费用后承保边际 ${formatPremiumWan(M)}万，边际率 ${formatPercent(marginRate)}。`,
      points: [
        `满期保费 ${formatPremiumWan(P)}万 → 赔款 ${formatPremiumWan(claim)}万（占比 ${formatPercent(P ? (claim / P) * 100 : 0)}）`,
        `费用及其他成本 ${formatPremiumWan(expenseOther)}万`,
        `承保边际 ${formatPremiumWan(M)}万，边际率 ${formatPercent(marginRate)}`,
      ],
    };
  }, [qWaterfall.data, qWaterfall.isLoading, qWaterfall.isError]);

  // ── Chart 09 机构亏损帕累托 ──
  const chart09: ChartResult<ParetoBar[]> = useMemo(() => {
    const rows = qOrg.data?.rows ?? [];
    const losses = rows
      .map((r) => ({ name: String(r.org_level_3 ?? '未知'), margin: wan(num(r.earned_margin_amount)) }))
      .filter((x) => Number.isFinite(x.margin) && x.margin < 0)
      .map((x) => ({ name: x.name, value: -x.margin }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    const total = losses.reduce((a, b) => a + b.value, 0);
    let acc = 0;
    const bars: ParetoBar[] = losses.map((b) => {
      acc += b.value;
      return { ...b, cumPct: total ? (acc / total) * 100 : 0 };
    });
    const s = state(qOrg, bars.length === 0);
    if (s.loading || s.error || s.empty) return { ...s, ...EMPTY_STATE, data: bars };
    const idx80 = bars.findIndex((b) => b.cumPct >= 80);
    const top3 = bars.slice(0, 3).reduce((a, b) => a + b.value, 0);
    return {
      ...s,
      data: bars,
      conclusion: `前 3 家机构贡献 ${formatPercent(total ? (top3 / total) * 100 : 0)} 承保亏损，专项治理应优先覆盖这 ${Math.min(3, bars.length)} 家。`,
      points: [
        `亏损机构共 ${bars.length} 家，累计亏损 ${formatPremiumWan(total * 1e4)}万`,
        idx80 >= 0 ? `累计占比越过 80% 出现在第 ${idx80 + 1} 家` : `亏损集中于头部机构`,
        `头部亏损：${bars.slice(0, 3).map((b) => b.name).join(' / ')}`,
      ],
    };
  }, [qOrg.data, qOrg.isLoading, qOrg.isError]);

  // ── Chart 10 险种结构树图 ──
  const chart10: ChartResult<TreemapCell[]> = useMemo(() => {
    const rows = qInsType.data?.rows ?? [];
    const items = rows
      .map((r) => ({ name: String(r.insurance_type ?? '未知'), value: wan(num(r.total_premium)) }))
      .filter((x) => Number.isFinite(x.value) && x.value > 0)
      .sort((a, b) => b.value - a.value);
    const total = items.reduce((a, b) => a + b.value, 0);
    const cells: TreemapCell[] = items.map((it) => ({ ...it, share: total ? (it.value / total) * 100 : 0 }));
    const s = state(qInsType, cells.length === 0);
    if (s.loading || s.error || s.empty) return { ...s, ...EMPTY_STATE, data: cells };
    const top = cells[0];
    return {
      ...s,
      data: cells,
      conclusion: `${top.name}贡献 ${formatPercent(top.share)} 保费，是绝对压舱石；业务组合共 ${cells.length} 类险种。`,
      points: cells.slice(0, 3).map((c) => `${c.name}：${formatPercent(c.share)}（${formatPremiumWan(c.value * 1e4)}万）`),
    };
  }, [qInsType.data, qInsType.isLoading, qInsType.isError]);

  // ── Chart 11 变动成本率控制图（CL±2σ 规则） ──
  const chart11 = useMemo(() => {
    const rows = [...(qWeek.data?.rows ?? [])].sort((a, b) => num(a.week_number) - num(b.week_number));
    const labels = rows.map((r) => `W${num(r.week_number)}`);
    const vals = rows.map((r) => num(r.variable_cost_ratio));
    const finite = vals.filter(Number.isFinite);
    const cl = mean(finite);
    const sd = std(finite);
    const ucl = cl + 2 * sd;
    const lcl = cl - 2 * sd;
    const s = state(qWeek, finite.length === 0);
    const data = { labels, vals, cl, ucl, lcl };
    if (s.loading || s.error || s.empty) return { ...s, ...EMPTY_STATE, data };
    const breaches = vals.filter((v) => Number.isFinite(v) && (v > ucl || v < lcl)).length;
    return {
      ...s,
      data,
      conclusion: breaches
        ? `${breaches} 个周次突破控制限（UCL ${formatPercent(ucl)}），属异常波动而非正常波动，需定点介入。`
        : `全部 ${finite.length} 周变动成本率在 CL±2σ 内，波动属正常范围，不必过度反应。`,
      points: [
        `CL = ${formatPercent(cl)}，UCL = ${formatPercent(ucl)}，LCL = ${formatPercent(Math.max(0, lcl))}`,
        breaches ? `突破点 ${breaches} 个，仅对突破点介入` : `无突破点，均在控制限内`,
        `控制限 = 历史均值 ± 2 倍标准差（规则）`,
      ],
    };
  }, [qWeek.data, qWeek.isLoading, qWeek.isError]);

  // ── Chart 12 赔付率-保费增速四象限 ──
  const chart12: ChartResult<PointDatum[]> = useMemo(() => {
    const lossRows = qOrg.data?.rows ?? [];
    const lossByOrg = new Map<string, number>();
    lossRows.forEach((r) => lossByOrg.set(String(r.org_level_3 ?? ''), num(r.earned_claim_ratio)));
    // 机构增速：取热力图各机构最新周期的同比增速
    const growthRows = qGrowth.data?.rows ?? [];
    const latestByOrg = new Map<string, { date: string; g: number }>();
    growthRows.forEach((r) => {
      const org = String(r.org_level_3 ?? '');
      const date = String(r.policy_date ?? '');
      const g = num(r.yoy_growth_rate);
      if (!Number.isFinite(g)) return;
      const prev = latestByOrg.get(org);
      if (!prev || date > prev.date) latestByOrg.set(org, { date, g });
    });
    const pts: PointDatum[] = [];
    lossByOrg.forEach((y, org) => {
      const gr = latestByOrg.get(org);
      if (org && gr && Number.isFinite(y)) pts.push({ name: org, x: gr.g, y });
    });
    const empty = pts.length === 0;
    const loading = qOrg.isLoading || qGrowth.isLoading;
    const error = qOrg.isError || qGrowth.isError;
    const s = { loading, error, empty: !loading && !error && empty };
    const xThreshold = pts.length ? mean(pts.map((p) => p.x)) : 0;
    const data = pts;
    if (loading || error || empty) return { ...s, ...EMPTY_STATE, data };
    const risk = pts.filter((p) => p.x >= xThreshold && p.y >= LOSS_RATIO_THRESHOLD).length;
    const good = pts.filter((p) => p.x >= xThreshold && p.y < LOSS_RATIO_THRESHOLD).length;
    return {
      ...s,
      data,
      conclusion: `机构分布呈四种动作原型：优质增长 ${good} 家（加码）、风险扩张 ${risk} 家（整改），而非单一"增长优先"。`,
      points: [
        `阈值：赔付率 ${LOSS_RATIO_THRESHOLD}%，增速 = 全省均值 ${formatPercent(xThreshold)}`,
        `优质增长（右下）${good} 家 —— 加码资源`,
        `风险扩张（右上）${risk} 家 —— 控制增速、优化结构`,
      ],
    };
  }, [qOrg.data, qOrg.isLoading, qOrg.isError, qGrowth.data, qGrowth.isLoading, qGrowth.isError]);

  return {
    chart01, chart02, chart03, chart04, chart05, chart06,
    chart07, chart08, chart09, chart10, chart11, chart12,
  };
}

export type ChartLedgerData = ReturnType<typeof useChartLedgerData>;
