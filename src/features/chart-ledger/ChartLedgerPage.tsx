/**
 * 保险经营图表账本页面（2026-07 Claude Design 重设计稿落地，方向 A：ghost 编号编辑感）
 *
 * 把「12 类经营图表方法论」按承保业务链路（渠道→承保→理赔→续保→财务）组织为单页，
 * 全部图表由真实项目数据驱动（pivot 原子指标 + claims-detail / quote-conversion / performance），
 * 每张图「结论先行 + 怎么看 + 真实数据要点 + 经营动作」。随全局筛选联动。
 *
 * 重设计要点：sticky 锚点导航带 scrollspy 当前阶段高亮；阶段/卡片 ghost 大编号做视觉锚点；
 * 动作层/动作标签用「颜色 + 形状」双编码（色盲安全）。
 * 数据装配见 hooks/useChartLedgerData.ts；叙述内容见 ledgerMeta.ts。
 */
import React, { useEffect, useState } from 'react';
import { cn, colorClasses, fontStyles, cardStyles } from '@/shared/styles';
import { CARD_META, FRAMEWORK, STAGES } from './ledgerMeta';
import { useChartLedgerData, LEDGER_DIM_OPTIONS, type LedgerDim } from './hooks/useChartLedgerData';
import { LedgerCard, ActionShapeIcon } from './components/LedgerCard';
import {
  ChannelMatrixChart,
  FeeOutlierChart,
  FrequencyTrendChart,
  ProfitWaterfallChart,
  LossParetoChart,
  ControlChart,
  QuadrantChart,
} from './components/EchartsPanels';
import {
  RiskHeatmapTable,
  LossTriangleTable,
  ClaimBoxplot,
  RenewalFunnel,
  InsuranceTreemap,
} from './components/CustomPanels';

const NAV = [
  { id: 'framework', num: '§0', label: '框架' },
  { id: 'stage-1', num: '01', label: '渠道' },
  { id: 'stage-2', num: '02', label: '承保' },
  { id: 'stage-3', num: '03', label: '理赔' },
  { id: 'stage-4', num: '04', label: '续保' },
  { id: 'stage-5', num: '05', label: '财务' },
];

/** scrollspy：视口顶部 120px 以内最后越过的 section 即当前阶段（用捕获监听兼容内层滚动容器） */
function useActiveSection(): string {
  const [active, setActive] = useState(NAV[0].id);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        let current = NAV[0].id;
        for (const { id } of NAV) {
          const el = document.getElementById(id);
          if (el && el.getBoundingClientRect().top <= 120) current = id;
        }
        setActive((prev) => (prev === current ? prev : current));
      });
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    onScroll();
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return active;
}

/** 链路层条目「01 渠道触达」→ 编号着主色 */
const ChainItem: React.FC<{ text: string }> = ({ text }) => {
  const m = /^(\d+)\s+(.*)$/.exec(text);
  if (!m) return <>{text}</>;
  return (
    <>
      <span className={cn('text-primary', fontStyles.numeric)}>{m[1]}</span> {m[2]}
    </>
  );
};

/** 动作层三行的「颜色 + 形状」图标（与卡片动作标签同一套编码） */
const ACTION_LEGEND: { icon: 'up' | 'diamond' | 'tri'; cls: string; text: string }[] = [
  { icon: 'up', cls: colorClasses.text.success, text: '加码 · 复制' },
  { icon: 'diamond', cls: colorClasses.text.warning, text: '优化 · 整改' },
  { icon: 'tri', cls: colorClasses.text.danger, text: '暂停 · 退出' },
];

/** 维度切换器：驱动 6 张实体图（产能/费用/热力/箱线/帕累托/结构）按所选维度重分组 */
const DimSwitcher: React.FC<{ value: LedgerDim; onChange: (d: LedgerDim) => void }> = ({ value, onChange }) => (
  <div
    role="group"
    aria-label="图表分组维度"
    className={cn('inline-flex items-center rounded-lg border p-0.5 gap-0.5', colorClasses.border.neutral, 'bg-neutral-50 dark:bg-surface-2')}
  >
    {LEDGER_DIM_OPTIONS.map((opt) => {
      const on = opt.key === value;
      return (
        <button
          key={opt.key}
          type="button"
          aria-pressed={on}
          onClick={() => onChange(opt.key)}
          className={cn(
            'px-3 py-1.5 rounded-md text-[13px] font-semibold whitespace-nowrap transition-colors',
            on
              ? cn('bg-primary text-white shadow-sm')
              : cn('bg-transparent hover:text-primary', colorClasses.text.neutralLight)
          )}
        >
          {opt.label}
        </button>
      );
    })}
  </div>
);

export const ChartLedgerPage: React.FC = () => {
  const [dim, setDim] = useState<LedgerDim>('customer_category');
  const d = useChartLedgerData(dim);
  const active = useActiveSection();

  // 图 id → 渲染节点
  const charts: Record<string, React.ReactNode> = {
    'chart-01': <ChannelMatrixChart r={d.chart01} />,
    'chart-02': <FeeOutlierChart r={d.chart02} />,
    'chart-03': <RiskHeatmapTable r={d.chart03} />,
    'chart-04': <ClaimBoxplot r={d.chart04} />,
    'chart-05': <FrequencyTrendChart r={d.chart05} />,
    'chart-06': <LossTriangleTable r={d.chart06} />,
    'chart-07': <RenewalFunnel r={d.chart07} />,
    'chart-08': <ProfitWaterfallChart r={d.chart08} />,
    'chart-09': <LossParetoChart r={d.chart09} />,
    'chart-10': <InsuranceTreemap r={d.chart10} />,
    'chart-11': <ControlChart r={d.chart11} />,
    'chart-12': <QuadrantChart r={d.chart12} />,
  };
  const results: Record<string, { loading: boolean; error: boolean; empty: boolean; conclusion: string; points: string[] }> = {
    'chart-01': d.chart01, 'chart-02': d.chart02, 'chart-03': d.chart03, 'chart-04': d.chart04,
    'chart-05': d.chart05, 'chart-06': d.chart06, 'chart-07': d.chart07, 'chart-08': d.chart08,
    'chart-09': d.chart09, 'chart-10': d.chart10, 'chart-11': d.chart11, 'chart-12': d.chart12,
  };

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 pb-24">
      {/* 锚点导航（scrollspy 高亮当前阶段） */}
      {/* dark 不用 /85 半透明：surface-* 是 CSS 变量色（无 <alpha-value>），Tailwind 透明度修饰不生效会浅色穿透 */}
      <nav className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 flex items-center gap-0.5 overflow-x-auto bg-white/85 dark:bg-surface-1 backdrop-blur border-b border-neutral-200 dark:border-subtle">
        {NAV.map((n) => {
          const on = n.id === active;
          return (
            <a
              key={n.id}
              href={`#${n.id}`}
              onClick={(e) => {
                // 应用是 hash 路由：裸锚点会顶掉 /#/chart-ledger 路由导致黑屏，改为页内平滑滚动
                e.preventDefault();
                document.getElementById(n.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              aria-current={on ? 'location' : undefined}
              className={cn(
                'flex items-center gap-1.5 py-3 px-3 text-[13px] whitespace-nowrap border-b-2 transition-colors',
                fontStyles.numeric,
                on
                  ? cn('border-primary font-semibold', colorClasses.text.primary)
                  : cn('border-transparent hover:text-primary', colorClasses.text.neutralLight)
              )}
            >
              <span className="text-primary font-semibold">{n.num}</span>
              {n.label}
            </a>
          );
        })}
        {/* 维度切换器：随导航常驻，滚动到任意图都可切换分组维度 */}
        <div className="ml-auto pl-3 flex items-center gap-2 shrink-0">
          <span className={cn('hidden md:inline text-[11px] tracking-[0.04em]', fontStyles.numeric, colorClasses.text.neutralMuted)}>分组维度</span>
          <DimSwitcher value={dim} onChange={setDim} />
        </div>
      </nav>

      {/* Hero */}
      <header className="pt-14 pb-9">
        <div className={cn('text-xs uppercase tracking-[0.18em] mb-4 font-semibold', fontStyles.numeric, colorClasses.text.primary)}>
          保险经营图表方法论 · 真实数据版
        </div>
        <h1 className={cn('text-3xl sm:text-4xl font-extrabold leading-[1.28] tracking-tight mb-5 max-w-[860px]', colorClasses.text.neutralBlack)}>
          图表分类该从<span className="text-primary">业务动作</span>出发，
          <br className="hidden sm:block" />
          而不是从图表<span className="text-primary">形态</span>出发。
        </h1>
        <p className={cn('text-base leading-[1.7] max-w-[680px]', colorClasses.text.neutralDark)}>
          "对比 / 趋势 / 结构 / 关系" 回答的是<b className={cn('font-semibold', colorClasses.text.neutralBlack)}>图怎么画</b>；经营管理需要回答的是
          <b className={cn('font-semibold', colorClasses.text.neutralBlack)}>看完图之后谁来改、改什么</b>。下文按承保经营链路——
          <b className={cn('font-semibold', colorClasses.text.neutralBlack)}>渠道 → 承保 → 理赔 → 续保 → 财务</b>
          ——组织 12 类图表，每张图接入真实项目数据、配使用说明与决策动作。
        </p>
        <p className={cn('text-[13px] leading-relaxed mt-3 max-w-[680px]', colorClasses.text.neutralMuted)}>
          右上角<b className={cn('font-semibold', colorClasses.text.neutralDark)}>分组维度</b>切换（机构 / 客户类别 / 险别组合，默认客户类别）作用于
          <b className={cn('font-semibold', colorClasses.text.neutralDark)}>产能矩阵 · 费用异常 · 风险热力 · 案均箱线 · 亏损帕累托 · 结构树图</b>
          6 张实体图；出险频度 / 发展三角 / 转化漏斗 / 能源瀑布 / 成本控制 5 张按各自口径固定；
          赔付率-增速四象限因增速仅机构级口径，恒按机构展示。
        </p>
      </header>

      {/* 三层框架 */}
      <section id="framework" className="scroll-mt-16 pb-12">
        <div className={cn('text-xs uppercase tracking-[0.14em] mb-4 font-semibold', fontStyles.numeric, colorClasses.text.neutralMuted)}>
          §0 · 三层框架总览
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* 目标层 / 链路层 */}
          {[FRAMEWORK.goal, FRAMEWORK.chain].map((col, idx) => (
            <div key={col.title} className={cn(cardStyles.base, 'p-5', idx === 1 && 'bg-neutral-100 dark:bg-surface-2')}>
              <h3 className={cn('text-lg font-bold mb-0.5', colorClasses.text.neutralBlack)}>{col.title}</h3>
              <div className={cn('text-[13px] mb-3', colorClasses.text.neutralMuted)}>{col.desc}</div>
              <ul className="space-y-0">
                {col.items.map((it, i) => (
                  <li key={i} className={cn('text-[13px] py-1.5 border-t first:border-t-0', colorClasses.border.neutral, colorClasses.text.neutralDark)}>
                    {idx === 1 ? <ChainItem text={it} /> : it}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {/* 动作层：颜色 + 形状双编码 */}
          <div className={cn(cardStyles.base, 'p-5')}>
            <h3 className={cn('text-lg font-bold mb-0.5', colorClasses.text.neutralBlack)}>{FRAMEWORK.action.title}</h3>
            <div className={cn('text-[13px] mb-3', colorClasses.text.neutralMuted)}>{FRAMEWORK.action.desc}</div>
            <div className="flex flex-col gap-2 mt-0.5">
              {ACTION_LEGEND.map((a) => (
                <span key={a.text} className={cn('inline-flex items-center gap-2 text-[13px]', colorClasses.text.neutralDark)}>
                  <span className={cn('inline-flex w-4 h-4 items-center justify-center', a.cls)}>
                    <ActionShapeIcon icon={a.icon} size={12} />
                  </span>
                  {a.text}
                </span>
              ))}
              <span className={cn('inline-flex items-center gap-2 text-[13px] pt-0.5', colorClasses.text.neutralMuted)}>
                {FRAMEWORK.action.items[FRAMEWORK.action.items.length - 1]}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 阶段 + 卡片 */}
      {STAGES.map((stage) => (
        <section key={stage.id} id={stage.id} className="scroll-mt-16 border-t border-neutral-200 dark:border-subtle pt-11">
          <div className="flex items-start gap-5 mb-1.5">
            <span className={cn('text-4xl font-extrabold leading-[0.85] text-neutral-200 dark:text-neutral-800', fontStyles.numeric)}>
              {stage.no}
            </span>
            <h2 className={cn('text-2xl font-extrabold tracking-tight pt-[3px]', colorClasses.text.neutralBlack)}>{stage.title}</h2>
          </div>
          <p className={cn('text-sm mb-5 max-w-2xl', colorClasses.text.neutralLight)}>{stage.tagline}</p>
          {stage.cardIds.map((id) => (
            <LedgerCard key={id} meta={CARD_META[id]} result={results[id]}>
              {charts[id]}
            </LedgerCard>
          ))}
        </section>
      ))}

      {/* 收尾：反方观点 */}
      <section className="border-t border-neutral-200 dark:border-subtle pt-12 mt-2">
        <div className={cn(cardStyles.base, 'p-6 sm:p-7 border-danger')}>
          <div className="flex items-center gap-2.5 mb-3.5">
            <span className={cn('inline-flex', colorClasses.text.danger)}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 2 L22 21 L2 21 Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M12 9 L12 15 M12 17.5 L12 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
            <h3 className={cn('text-xl font-extrabold tracking-tight', colorClasses.text.danger)}>最强反方观点</h3>
          </div>
          <p className={cn('text-sm leading-[1.75] mb-4 max-w-[760px]', colorClasses.text.neutralDark)}>
            图表分类越多，不代表管理越有效。前线管理者真正需要的不是"图表百科"，而是少量高频、可解释、能触发动作的图表组合。
            12 类图表全部铺开，本身就是一种"看似全面、实则失焦"的风险。
          </p>
          <div className={cn('text-[11px] uppercase tracking-[0.06em] mb-2.5', fontStyles.numeric, colorClasses.text.neutralMuted)}>五个失败条件</div>
          <ol className="space-y-2.5 max-w-[820px]">
            {[
              ['指标口径不统一', '各部门算法不同，图表之间无法互相印证。'],
              ['无法下钻到责任主体', '只能看省级汇总，不能穿透到机构、渠道、保单、案件。'],
              ['图表没有对应动作', '看完只知道"有问题"，不知道谁改、怎么改、何时改。'],
              ['只看规模不看质量', '保费增长掩盖赔付、费用和合规风险的恶化。'],
              ['数据时效不足', '经营管理需要周度甚至日度预警，月末复盘往往已经太晚。'],
            ].map(([title, desc], i) => (
              <li key={title} className={cn('relative pl-[34px] text-sm leading-relaxed', colorClasses.text.neutralDark)}>
                <span
                  className={cn(
                    'absolute left-0 top-0 w-[22px] h-[22px] rounded-full border border-warning bg-warning-bg flex items-center justify-center text-xs font-bold',
                    fontStyles.numeric,
                    colorClasses.text.warningDark
                  )}
                >
                  {i + 1}
                </span>
                <b className={cn('font-bold', colorClasses.text.neutralBlack)}>{title}</b> —— {desc}
              </li>
            ))}
          </ol>
          <p className={cn('text-center text-lg font-semibold mt-6 pt-5 border-t', colorClasses.border.neutral, colorClasses.text.warningDark)}>
            经营问题 → 指标口径 → 图表表达 → 管理判断 → 决策动作
          </p>
        </div>
        <p className={cn('text-center text-[11px] mt-5 tracking-[0.08em]', fontStyles.numeric, colorClasses.text.neutralMuted)}>
          保险经营图表账本 · 数据来自本项目真实查询（随全局筛选联动）
        </p>
      </section>
    </div>
  );
};

export default ChartLedgerPage;
