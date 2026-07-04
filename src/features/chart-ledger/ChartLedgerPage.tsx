/**
 * 保险经营图表账本页面
 *
 * 把「12 类经营图表方法论」按承保业务链路（渠道→承保→理赔→续保→财务）组织为单页，
 * 全部图表由真实项目数据驱动（pivot 原子指标 + claims-detail / quote-conversion / performance），
 * 每张图「结论先行 + 怎么看 + 真实数据要点 + 经营动作」。随全局筛选联动。
 *
 * 数据装配见 hooks/useChartLedgerData.ts；叙述内容见 ledgerMeta.ts。
 */
import React from 'react';
import { cn, colorClasses, fontStyles, cardStyles } from '@/shared/styles';
import { CARD_META, FRAMEWORK, STAGES } from './ledgerMeta';
import { useChartLedgerData } from './hooks/useChartLedgerData';
import { LedgerCard } from './components/LedgerCard';
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
  { href: '#framework', num: '§0', label: '框架' },
  { href: '#stage-1', num: '01', label: '渠道' },
  { href: '#stage-2', num: '02', label: '承保' },
  { href: '#stage-3', num: '03', label: '理赔' },
  { href: '#stage-4', num: '04', label: '续保' },
  { href: '#stage-5', num: '05', label: '财务' },
];

export const ChartLedgerPage: React.FC = () => {
  const d = useChartLedgerData();

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
    <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-24">
      {/* 锚点导航 */}
      <nav className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 flex items-center gap-1 overflow-x-auto bg-white/85 dark:bg-surface-1/85 backdrop-blur border-b border-neutral-200 dark:border-subtle">
        {NAV.map((n) => (
          <a
            key={n.href}
            href={n.href}
            className={cn('flex items-center gap-1.5 py-3.5 px-3 text-xs whitespace-nowrap font-numeric', colorClasses.text.neutral, 'hover:text-primary')}
          >
            <span className="text-primary">{n.num}</span>
            {n.label}
          </a>
        ))}
      </nav>

      {/* Hero */}
      <header className="pt-12 pb-8">
        <div className={cn('text-xs uppercase tracking-[0.16em] mb-4 font-numeric', colorClasses.text.primary)}>
          保险经营图表方法论 · 真实数据版
        </div>
        <h1 className={cn('text-3xl sm:text-4xl font-bold leading-tight mb-5', colorClasses.text.neutralBlack)}>
          图表分类该从<span className="text-primary">业务动作</span>出发，
          <br className="hidden sm:block" />
          而不是从图表<span className="text-primary">形态</span>出发。
        </h1>
        <p className={cn('text-[15px] max-w-2xl', colorClasses.text.neutral)}>
          "对比 / 趋势 / 结构 / 关系" 回答的是<b className={colorClasses.text.neutralBlack}>图怎么画</b>；经营管理需要回答的是
          <b className={colorClasses.text.neutralBlack}>看完图之后谁来改、改什么</b>。下文按承保经营链路——
          <b className={colorClasses.text.neutralBlack}>渠道 → 承保 → 理赔 → 续保 → 财务</b>
          ——组织 12 类图表，每张图接入真实项目数据、配使用说明与决策动作。
        </p>
      </header>

      {/* 三层框架 */}
      <section id="framework" className="scroll-mt-16 pb-12">
        <div className={cn('text-xs uppercase tracking-wider mb-4 font-numeric', colorClasses.text.neutralMuted)}>
          §0 · 三层框架总览
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[FRAMEWORK.goal, FRAMEWORK.chain, FRAMEWORK.action].map((col, idx) => (
            <div key={col.title} className={cn(cardStyles.base, 'p-5', idx === 1 && 'bg-neutral-50 dark:bg-surface-2')}>
              <h3 className={cn('text-lg font-bold mb-1', colorClasses.text.neutralBlack)}>{col.title}</h3>
              <div className={cn('text-[13px] mb-3', colorClasses.text.neutralMuted)}>{col.desc}</div>
              <ul className="space-y-0">
                {col.items.map((it, i) => (
                  <li key={i} className={cn('text-[13px] py-1.5 border-t first:border-t-0', colorClasses.border.neutral, colorClasses.text.neutralDark)}>
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* 阶段 + 卡片 */}
      {STAGES.map((stage) => (
        <section key={stage.id} id={stage.id} className="scroll-mt-16 border-t border-neutral-200 dark:border-subtle pt-10">
          <div className="flex items-baseline gap-4 mb-1.5">
            <span className={cn('text-sm font-numeric', colorClasses.text.primary)}>{stage.no}</span>
            <h2 className={cn('text-2xl font-bold', colorClasses.text.neutralBlack)}>{stage.title}</h2>
          </div>
          <p className={cn('text-sm mb-6 max-w-2xl', colorClasses.text.neutralMuted)}>{stage.tagline}</p>
          {stage.cardIds.map((id) => (
            <LedgerCard key={id} meta={CARD_META[id]} result={results[id]}>
              {charts[id]}
            </LedgerCard>
          ))}
        </section>
      ))}

      {/* 收尾：反方观点 */}
      <section className="border-t border-neutral-200 dark:border-subtle pt-12 mt-4">
        <div className={cn(cardStyles.base, 'p-6 border-danger-border')}>
          <h3 className={cn('text-lg font-bold mb-3', colorClasses.text.danger)}>最强反方观点</h3>
          <p className={cn('text-sm mb-3', colorClasses.text.neutralDark)}>
            图表分类越多，不代表管理越有效。前线管理者真正需要的不是"图表百科"，而是少量高频、可解释、能触发动作的图表组合。
            12 类图表全部铺开，本身就是一种"看似全面、实则失焦"的风险。
          </p>
          <div className={cn('text-[11px] font-numeric mb-1', colorClasses.text.neutralMuted)}>五个失败条件</div>
          <ol className={cn('list-decimal pl-5 space-y-1.5 text-sm', colorClasses.text.neutral)}>
            <li><b className={colorClasses.text.neutralBlack}>指标口径不统一</b> —— 各部门算法不同，图表之间无法互相印证。</li>
            <li><b className={colorClasses.text.neutralBlack}>无法下钻到责任主体</b> —— 只能看省级汇总，不能穿透到机构、渠道、保单、案件。</li>
            <li><b className={colorClasses.text.neutralBlack}>图表没有对应动作</b> —— 看完只知道"有问题"，不知道谁改、怎么改、何时改。</li>
            <li><b className={colorClasses.text.neutralBlack}>只看规模不看质量</b> —— 保费增长掩盖赔付、费用和合规风险的恶化。</li>
            <li><b className={colorClasses.text.neutralBlack}>数据时效不足</b> —— 经营管理需要周度甚至日度预警，月末复盘往往已经太晚。</li>
          </ol>
          <p className={cn('text-center text-lg font-medium mt-6 pt-4 border-t', colorClasses.border.neutral, colorClasses.text.warningDark)}>
            经营问题 → 指标口径 → 图表表达 → 管理判断 → 决策动作
          </p>
        </div>
        <p className={cn('text-center text-[11px] mt-6 font-numeric', colorClasses.text.neutralMuted, fontStyles.numeric)}>
          INSURANCE OPERATIONS CHART LEDGER · 数据来自本项目真实查询（随全局筛选联动）
        </p>
      </section>
    </div>
  );
};

export default ChartLedgerPage;
