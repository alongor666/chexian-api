/**
 * 续保巡检报告 Tab
 *
 * 展示离线巡检引擎产出的结构化报告：
 * - 异常摘要卡片区（四级亮灯，移动端 2x2 网格）
 * - 重点关注区（自动提取红灯/橙灯最严重条目）
 * - 维度分析表格（默认折叠，只展开红灯最多维度）
 * - 盲点发现列表（严重度芯片筛选）
 * - 环比变化表格
 * - 行动跳转按钮
 */

import { useState, useMemo } from 'react';
import { cardStyles, tableStyles, textStyles, colorClasses, alertStyles, buttonStyles } from '../../../shared/styles';
import { usePatrolReport } from '../hooks/useRenewalV2';
import type {
  PatrolReport, PatrolSection, PatrolBlindspot,
  PatrolComparison, PatrolAlertLevel,
  AIFinding, AIPatrolMeta,
} from '../../../shared/types/patrol';

const ALERT_STYLES = alertStyles;

// ── 摘要卡片 ──

function AlertSummaryCards({ report }: { report: PatrolReport }) {
  const { summary, overall } = report;
  const cards = [
    { label: '严重', count: summary.red_count, alert: 'red' as const },
    { label: '预警', count: summary.orange_count, alert: 'orange' as const },
    { label: '关注', count: summary.yellow_count, alert: 'yellow' as const },
    { label: '正常', count: summary.green_count, alert: 'green' as const },
  ];

  return (
    <div className="space-y-3">
      {/* 亮灯统计 — 移动端 2x2，桌面端 4 列 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {cards.map(c => {
          const style = ALERT_STYLES[c.alert];
          return (
            <div key={c.alert} className={`${style.bg} rounded-lg p-3 text-center`}>
              <div className="text-2xl">{style.emoji}</div>
              <div className={`text-xl font-bold ${style.text}`}>{c.count}</div>
              <div className={`text-xs ${style.text} opacity-75`}>{c.label}</div>
            </div>
          );
        })}
      </div>

      {/* 整体指标 */}
      <div className={cardStyles.base}>
        <h3 className={textStyles.titleSmall}>整体指标</h3>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-2">
          {Object.entries(overall).map(([key, metric]) => {
            const style = ALERT_STYLES[metric.alert];
            return (
              <div key={key} className={`${style.bg} rounded-lg p-2.5`}>
                <div className={`text-xs ${colorClasses.text.neutralMuted}`}>{metric.display_name ?? key}</div>
                <div className={`text-lg font-semibold ${style.text}`}>{metric.display}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── 重点关注区 ──

interface FocusItem {
  dimName: string;
  dimValue: string;
  metricName: string;
  metricDisplay: string;
  alert: PatrolAlertLevel;
}

function FocusAlerts({ report }: { report: PatrolReport }) {
  const items = useMemo(() => {
    const collected: FocusItem[] = [];
    for (const section of report.sections) {
      for (const finding of section.findings) {
        if (finding.worst_alert !== 'red' && finding.worst_alert !== 'orange') continue;
        // 找到该 finding 中最严重的指标
        const worstMetric = Object.entries(finding.metrics).reduce<{ id: string; name: string; display: string; alert: PatrolAlertLevel } | null>(
          (worst, [id, m]) => {
            if (!m) return worst;
            if (!worst) return { id, name: m.display_name ?? id, display: m.display, alert: m.alert };
            const priority: Record<string, number> = { red: 0, orange: 1, yellow: 2, green: 3 };
            return (priority[m.alert] ?? 3) < (priority[worst.alert] ?? 3)
              ? { id, name: m.display_name ?? id, display: m.display, alert: m.alert }
              : worst;
          },
          null,
        );
        if (worstMetric) {
          collected.push({
            dimName: section.dimension_name,
            dimValue: finding.dim_value,
            metricName: worstMetric.name,
            metricDisplay: worstMetric.display,
            alert: finding.worst_alert,
          });
        }
      }
    }
    // 红灯优先，同级按指标值排序
    const priority: Record<string, number> = { red: 0, orange: 1, yellow: 2, green: 3 };
    collected.sort((a, b) => (priority[a.alert] ?? 3) - (priority[b.alert] ?? 3));
    return collected.slice(0, 5);
  }, [report.sections]);

  if (items.length === 0) return null;

  return (
    <div className={cardStyles.base}>
      <h3 className={textStyles.titleSmall}>重点关注</h3>
      <div className="mt-2 space-y-1.5">
        {items.map((item, i) => {
          const style = ALERT_STYLES[item.alert];
          return (
            <div key={i} className={`flex items-center gap-2 ${style.bg} rounded-lg px-3 py-2`}>
              <span>{style.emoji}</span>
              <span className={`text-sm ${style.text} font-medium`}>
                {item.dimValue}
              </span>
              <span className={`text-sm ${colorClasses.text.neutral}`}>
                {item.metricName}
              </span>
              <span className={`text-sm font-semibold ${style.text} ml-auto`}>
                {item.metricDisplay}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 维度分析表格 ──

function DimensionSection({ section, defaultExpanded }: { section: PatrolSection; defaultExpanded: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const metricIds = section.findings[0]
    ? Object.keys(section.findings[0].metrics)
    : [];

  // 统计警报分布
  const alertDist = section.findings.reduce(
    (acc, f) => {
      acc[f.worst_alert] = (acc[f.worst_alert] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className={cardStyles.base}>
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between"
      >
        <h3 className={textStyles.titleSmall}>
          {section.dimension_name}
          <span className={`ml-2 text-xs ${colorClasses.text.neutralMuted}`}>
            ({section.group_count} 组)
          </span>
        </h3>
        <div className="flex items-center gap-1 text-xs">
          {alertDist.red && <span className="text-red-600 dark:text-red-400">🔴{alertDist.red}</span>}
          {alertDist.orange && <span className="text-orange-600 dark:text-orange-400">🟠{alertDist.orange}</span>}
          {alertDist.yellow && <span className="text-yellow-600 dark:text-yellow-400">🟡{alertDist.yellow}</span>}
          <span className="ml-1">{expanded ? '▼' : '▶'}</span>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 overflow-x-auto">
          <table className={tableStyles.container}>
            <thead>
              <tr>
                <th className={tableStyles.headerCell}>{section.dimension_name}</th>
                <th className={`${tableStyles.headerCell} text-right`}>样本</th>
                {metricIds.map(id => (
                  <th key={id} className={`${tableStyles.headerCell} text-right hidden sm:table-cell`}>
                    {section.findings[0].metrics[id]?.display_name ?? id}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.findings.map(f => {
                const rowStyle = ALERT_STYLES[f.worst_alert];
                return (
                  <tr key={f.dim_value} className={`${rowStyle.bg} border-b border-neutral-100 dark:border-neutral-800`}>
                    <td className={tableStyles.cell}>
                      <span className="mr-1">{rowStyle.emoji}</span>
                      {f.dim_value}
                    </td>
                    <td className={`${tableStyles.cell} text-right tabular-nums`}>
                      {f.sample_size.toLocaleString()}
                    </td>
                    {metricIds.map(id => {
                      const m = f.metrics[id];
                      const mStyle = m ? ALERT_STYLES[m.alert] : ALERT_STYLES.green;
                      return (
                        <td key={id} className={`${tableStyles.cell} text-right tabular-nums ${mStyle.text} hidden sm:table-cell`}>
                          {m?.display ?? 'N/A'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── 盲点发现 ──

type BlindspotFilter = 'all' | 'red' | 'orange';

function BlindspotsList({ blindspots }: { blindspots: PatrolBlindspot[] }) {
  const [showAll, setShowAll] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<BlindspotFilter>('all');

  const filtered = useMemo(() => {
    if (severityFilter === 'all') return blindspots;
    return blindspots.filter(bs => bs.alert === severityFilter);
  }, [blindspots, severityFilter]);

  const visible = showAll ? filtered : filtered.slice(0, 15);

  if (blindspots.length === 0) return null;

  const chips: Array<{ key: BlindspotFilter; label: string }> = [
    { key: 'all', label: `全部 (${blindspots.length})` },
    { key: 'red', label: `🔴 严重 (${blindspots.filter(b => b.alert === 'red').length})` },
    { key: 'orange', label: `🟠 预警 (${blindspots.filter(b => b.alert === 'orange').length})` },
  ];

  return (
    <div className={cardStyles.base}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className={textStyles.titleSmall}>
          盲点发现
          <span className={`ml-2 text-xs ${colorClasses.text.neutralMuted}`}>
            ({filtered.length} 个交叉异常)
          </span>
        </h3>
        {/* 严重度芯片筛选 */}
        <div className="flex gap-1">
          {chips.map(chip => (
            <button
              key={chip.key}
              onClick={() => { setSeverityFilter(chip.key); setShowAll(false); }}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                severityFilter === chip.key
                  ? 'bg-neutral-800 text-white dark:bg-white/15 dark:text-neutral-100'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-white/6 dark:text-neutral-300 dark:hover:bg-white/12'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className={tableStyles.container}>
          <thead>
            <tr>
              <th className={tableStyles.headerCell}>维度组合</th>
              <th className={`${tableStyles.headerCell} text-right`}>指标值</th>
              <th className={`${tableStyles.headerCell} text-right hidden sm:table-cell`}>整体值</th>
              <th className={`${tableStyles.headerCell} text-right hidden sm:table-cell`}>偏离</th>
              <th className={`${tableStyles.headerCell} text-right`}>样本</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((bs, i) => {
              const style = ALERT_STYLES[bs.alert];
              const deviationColor = bs.direction === 'above'
                ? colorClasses.text.success
                : colorClasses.text.danger;
              return (
                <tr key={i} className="border-b border-neutral-100 dark:border-neutral-800">
                  <td className={tableStyles.cell}>
                    <span className="mr-1">{style.emoji}</span>
                    {bs.dimensions.map(d => `${d.name}=${d.value}`).join(' × ')}
                  </td>
                  <td className={`${tableStyles.cell} text-right tabular-nums ${style.text}`}>
                    {bs.metric_display}
                  </td>
                  <td className={`${tableStyles.cell} text-right tabular-nums hidden sm:table-cell`}>
                    {bs.overall_display}
                  </td>
                  <td className={`${tableStyles.cell} text-right tabular-nums font-medium ${deviationColor} hidden sm:table-cell`}>
                    {bs.deviation_display}
                  </td>
                  <td className={`${tableStyles.cell} text-right tabular-nums`}>
                    {bs.sample_size.toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filtered.length > 15 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className={`mt-2 text-sm ${colorClasses.text.primary} hover:underline`}
        >
          {showAll ? '收起' : `显示全部 ${filtered.length} 个`}
        </button>
      )}
    </div>
  );
}

// ── 环比变化 ──

function ComparisonTable({ comparisons }: { comparisons: PatrolComparison[] }) {
  if (comparisons.length === 0) return null;

  return (
    <div className={cardStyles.base}>
      <h3 className={textStyles.titleSmall}>环比变化</h3>
      <div className="mt-3 overflow-x-auto">
        <table className={tableStyles.container}>
          <thead>
            <tr>
              <th className={tableStyles.headerCell}>期间</th>
              <th className={`${tableStyles.headerCell} text-right`}>样本</th>
              {comparisons[0]?.changes.map(c => (
                <th key={c.metric_id} className={`${tableStyles.headerCell} text-right`}>{c.metric_name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comparisons.map((comp, i) => (
              <tr key={i} className="border-b border-neutral-100 dark:border-neutral-800">
                <td className={tableStyles.cell}>
                  {comp.prev_period}月 → {comp.curr_period}月
                </td>
                <td className={`${tableStyles.cell} text-right tabular-nums`}>
                  {comp.curr_sample.toLocaleString()}
                </td>
                {comp.changes.map(c => {
                  const changeColor = c.significant
                    ? (c.change > 0 ? colorClasses.text.success : colorClasses.text.danger)
                    : colorClasses.text.neutralMuted;
                  return (
                    <td key={c.metric_id} className={`${tableStyles.cell} text-right tabular-nums`}>
                      <span>{c.curr_display}</span>
                      <span className={`ml-1 text-xs ${changeColor}`}>
                        ({c.change_display})
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── AI 深度研判 ──

const DISCOVERY_LABELS: Record<AIFinding['discovered_via'], string> = {
  config_drill: '维度分析',
  cross_drill: '交叉盲点',
  exploration: 'AI 探索',
};

function AIFindingsCard({ findings, meta }: { findings: AIFinding[]; meta?: AIPatrolMeta }) {
  if (findings.length === 0) return null;

  return (
    <div className={cardStyles.base}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className={textStyles.titleSmall}>
          AI 深度研判
          <span className={`ml-2 text-xs ${colorClasses.text.neutralMuted}`}>
            ({findings.length} 条发现)
          </span>
        </h3>
        {meta && (
          <span className={`text-xs ${colorClasses.text.neutralMuted}`}>
            {meta.queries_executed} 次查询 · {meta.duration_seconds}s
          </span>
        )}
      </div>
      <div className="mt-3 space-y-3">
        {findings.map((finding, i) => {
          const style = ALERT_STYLES[finding.severity];
          return (
            <div key={i} className={`${style.bg} rounded-lg p-3`}>
              <div className="flex items-start gap-2">
                <span className="text-base leading-5">{style.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-semibold ${style.text}`}>{finding.title}</span>
                    <span className={`px-1.5 py-0.5 text-xs rounded ${colorClasses.bg.neutralLight} ${colorClasses.text.neutralMuted}`}>
                      {DISCOVERY_LABELS[finding.discovered_via]}
                    </span>
                  </div>
                  <div className={`mt-1 flex items-center gap-3 text-xs ${colorClasses.text.neutral}`}>
                    <span>指标值: <strong className={style.text}>{finding.metric_value}</strong></span>
                    <span>整体: <strong>{finding.overall_value}</strong></span>
                  </div>
                  <p className={`mt-1.5 text-sm ${colorClasses.text.neutralDark}`}>{finding.narrative}</p>
                  {finding.evidence && finding.evidence.length > 0 && (
                    <details className="mt-2">
                      <summary className={`text-xs ${colorClasses.text.neutralMuted} cursor-pointer hover:underline`}>
                        查看证据 ({finding.evidence.length})
                      </summary>
                      <div className="mt-1 space-y-1">
                        {finding.evidence.map((ev, j) => (
                          <div key={j} className={`text-xs ${colorClasses.bg.neutral} rounded p-2`}>
                            <code className={colorClasses.text.neutralMuted}>{ev.query}</code>
                            <div className={`mt-0.5 ${colorClasses.text.neutralDark}`}>{ev.result}</div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {meta?.extra_dimensions_explored && meta.extra_dimensions_explored.length > 0 && (
        <div className={`mt-3 text-xs ${colorClasses.text.neutralMuted}`}>
          额外探索维度: {meta.extra_dimensions_explored.join('、')}
        </div>
      )}
    </div>
  );
}

// ── 主组件 ──

interface RenewalPatrolTabProps {
  onNavigateToAction?: () => void;
}

export function RenewalPatrolTab({ onNavigateToAction }: RenewalPatrolTabProps) {
  const { data, isLoading, error, refetch } = usePatrolReport('renewal');

  if (isLoading) {
    return <div className="p-8 text-center text-neutral-400">加载巡检报告中...</div>;
  }

  // 拆分空态和错误态
  if (error || !data?.report) {
    const is404 = error && typeof error === 'object' && 'status' in error && (error as any).status === 404;
    const isNotGenerated = is404 || (!error && !data?.report);

    if (isNotGenerated) {
      return (
        <div className={`${cardStyles.base} text-center py-8`}>
          <p className={colorClasses.text.neutralDark}>
            还没有巡检报告
          </p>
          <p className={`text-sm mt-1 ${colorClasses.text.neutralMuted}`}>
            请管理员运行 <code className="bg-neutral-100 dark:bg-neutral-800 px-1 rounded">python3 数据管理/patrol/patrol_engine.py --domain renewal</code> 生成报告
          </p>
        </div>
      );
    }

    return (
      <div className={`${cardStyles.base} text-center py-8`}>
        <p className={colorClasses.text.danger}>
          加载失败
        </p>
        <p className={`text-sm mt-1 ${colorClasses.text.neutralMuted}`}>
          网络异常或服务不可用，请稍后重试
        </p>
        <button
          onClick={() => refetch()}
          className={`mt-3 ${buttonStyles.base} ${buttonStyles.secondary} ${buttonStyles.sizeSmall}`}
        >
          重试
        </button>
      </div>
    );
  }

  const report: PatrolReport = data.report;

  // 找出红灯最多的维度，作为默认展开项
  const mostRedSectionId = report.sections.reduce<string | null>((bestId, section) => {
    if (!bestId) return section.dimension_id;
    const bestSection = report.sections.find(s => s.dimension_id === bestId);
    const bestRedCount = bestSection?.findings.filter(f => f.worst_alert === 'red').length ?? 0;
    const currRedCount = section.findings.filter(f => f.worst_alert === 'red').length;
    return currRedCount > bestRedCount ? section.dimension_id : bestId;
  }, null);

  return (
    <div className="space-y-4">
      {/* 摘要卡片 */}
      <AlertSummaryCards report={report} />

      {/* 重点关注 */}
      <FocusAlerts report={report} />

      {/* 维度分析 */}
      {report.sections.map(section => (
        <DimensionSection
          key={section.dimension_id}
          section={section}
          defaultExpanded={section.dimension_id === mostRedSectionId}
        />
      ))}

      {/* 盲点发现 */}
      <BlindspotsList blindspots={report.blindspots} />

      {/* AI 深度研判 */}
      {report.ai_findings && report.ai_findings.length > 0 && (
        <AIFindingsCard findings={report.ai_findings} meta={report.ai_meta} />
      )}

      {/* 环比变化 */}
      <ComparisonTable comparisons={report.comparisons} />

      {/* 行动跳转 */}
      {onNavigateToAction && (
        <div className="text-center">
          <button
            onClick={onNavigateToAction}
            className={`${buttonStyles.base} ${buttonStyles.primary} ${buttonStyles.sizeMedium}`}
          >
            查看行动看板
          </button>
        </div>
      )}

      {/* 元信息 */}
      <div className={`text-xs ${colorClasses.text.neutralMuted} text-right`}>
        生成于 {new Date(report.generated_at).toLocaleString('zh-CN')} ·
        {report.summary.total_records?.toLocaleString()} 条数据 ·
        耗时 {report.summary.elapsed_seconds}s
        {report.ai_meta && (
          <> · AI {report.ai_meta.queries_executed} 次查询 / {report.ai_meta.duration_seconds}s</>
        )}
      </div>
    </div>
  );
}
