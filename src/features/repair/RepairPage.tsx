import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import {
  cardStyles,
  textStyles,
  buttonStyles,
  colorClasses,
  cn,
} from '@/shared/styles';
import { formatPremiumWan, formatCount } from '@/shared/utils/formatters';
import { ErrorState } from '@/shared/ui';
import { RepairScatter, type ScatterShopPoint } from './components/RepairScatter';
import { RepairShopDrawer } from './components/RepairShopDrawer';
import { RepairDiversionList } from './components/RepairDiversionList';
import {
  type TimeWindow,
  type CoopTierFilter,
  type CoopTierRow,
  buildRepairParams,
  findTierRow,
  computeToPremiumTotals,
} from './utils/repairKpi';

interface RepairMetadata {
  orgs: string[];
  statuses: string[];
  total_shops: number;
}

const TIME_OPTIONS: { value: TimeWindow; label: string }[] = [
  { value: 'ytd', label: '本年度' },
  { value: 'rolling12', label: '滚动12月' },
  { value: 'all', label: '全部' },
];

const TIER_TAB: { value: CoopTierFilter; label: string }[] = [
  { value: '', label: '全部状态' },
  { value: 'active', label: '已合作' },
  { value: 'past', label: '曾合作' },
  { value: 'none', label: '未合作' },
];

export const RepairPage: React.FC = () => {
  const [orgFilter, setOrgFilter] = useState<string>('');
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('ytd');
  const [coopTier, setCoopTier] = useState<CoopTierFilter>('');
  const [selectedShop, setSelectedShop] = useState<ScatterShopPoint | null>(null);

  const params = useMemo(
    () => buildRepairParams(orgFilter, timeWindow, coopTier),
    [orgFilter, timeWindow, coopTier]
  );

  const { data: metadata } = useQuery({
    queryKey: ['repair-metadata'],
    queryFn: () => apiClient.repair.metadata() as Promise<RepairMetadata>,
  });

  const coopTierQuery = useQuery({
    queryKey: ['repair-coop-tier', params],
    queryFn: () => apiClient.repair.coopTier(params) as Promise<CoopTierRow[]>,
  });

  const scatterQuery = useQuery({
    queryKey: ['repair-scatter', params],
    queryFn: () => apiClient.repair.scatter(params) as Promise<ScatterShopPoint[]>,
  });

  const toPremiumQuery = useQuery({
    queryKey: ['repair-to-premium-all', params],
    queryFn: () =>
      apiClient.repair.toPremium(params) as Promise<
        Array<{
          damage_amount: number;
          net_premium: number;
          repair_to_premium_ratio: number | null;
        }>
      >,
  });
  const { data: coopTierData } = coopTierQuery;
  const { data: scatterData, isLoading: scatterLoading } = scatterQuery;
  const { data: toPremiumAll } = toPremiumQuery;

  // 页面级错误态（05dff4 ⑥）：三个数据查询任一失败即提示 + 重试（此前失败静默显示全 0）
  const dataQueries = [coopTierQuery, scatterQuery, toPremiumQuery];
  const firstError = dataQueries.find((q) => q.isError)?.error;

  // KPI 计算
  const tierRows = coopTierData ?? [];
  const activeRow = findTierRow(tierRows, 'active');
  const pastRow = findTierRow(tierRows, 'past');
  const noneRow = findTierRow(tierRows, 'none');
  const shadowRow = findTierRow(tierRows, 'none_shadow');

  const toPRows = toPremiumAll ?? [];
  const { totalDamage, totalPremium, overallRatio } = computeToPremiumTotals(toPRows);

  const orgs = metadata?.orgs ?? [];

  return (
    <div className="space-y-4">
      {/* 标题栏 */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className={textStyles.titleMedium}>维修资源分析</h2>
          <p className={cn(textStyles.caption, 'mt-1')}>
            合作网点分布 · 本地资源占比 · 导流目标识别
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            className="border border-neutral-200 rounded px-3 py-1.5 text-sm"
            value={orgFilter}
            onChange={e => setOrgFilter(e.target.value)}
          >
            <option value="">全部机构</option>
            {orgs.map(o => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <div className="flex items-center rounded border border-neutral-200 overflow-hidden">
            {TIME_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setTimeWindow(opt.value)}
                className={cn(
                  'px-3 py-1.5 text-xs',
                  timeWindow === opt.value
                    ? 'bg-primary text-white'
                    : 'bg-white text-neutral-700 hover:bg-neutral-50',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {firstError ? (
        <div className={cardStyles.base}>
          <ErrorState
            title="维修资源数据加载失败"
            message={firstError instanceof Error ? firstError.message : String(firstError)}
            onRetry={() => dataQueries.forEach((q) => q.isError && void q.refetch())}
          />
        </div>
      ) : (
      <>
      {/* KPI 区（三态网点 + 修保比） */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        <KpiCell
          label="已合作网点"
          value={formatCount(activeRow.shop_count)}
          sub={`${formatPremiumWan(activeRow.net_premium)} 万保费`}
          accent={colorClasses.text.success}
        />
        <KpiCell
          label="曾合作网点"
          value={formatCount(pastRow.shop_count)}
          sub={`${formatPremiumWan(pastRow.net_premium)} 万保费`}
          accent={colorClasses.text.warningDark}
        />
        <KpiCell
          label="未合作网点"
          value={formatCount(noneRow.shop_count)}
          sub={`${formatPremiumWan(noneRow.net_premium)} 万保费`}
          accent={colorClasses.text.neutralMuted}
        />
        <KpiCell
          label="影子网点"
          value={formatCount(shadowRow.shop_count)}
          sub="仅理赔可见"
          accent={colorClasses.text.danger}
        />
        <KpiCell
          label="整体修保比"
          value={overallRatio != null ? overallRatio.toFixed(3) : '—'}
          sub={`${formatPremiumWan(totalDamage)} 万 / ${formatPremiumWan(totalPremium)} 万`}
          accent={colorClasses.text.primaryDark}
        />
      </div>

      {/* 三态过滤 Tab */}
      <div className="flex items-center gap-2">
        {TIER_TAB.map(t => (
          <button
            key={t.value || 'all'}
            onClick={() => setCoopTier(t.value)}
            className={cn(
              buttonStyles.base,
              buttonStyles.sizeSmall,
              coopTier === t.value ? buttonStyles.primary : buttonStyles.secondary,
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 区县×机构散点 */}
      <RepairScatter
        data={scatterData ?? []}
        loading={scatterLoading}
        onPointClick={shop => setSelectedShop(shop)}
      />

      {/* 导流清单 */}
      <RepairDiversionList orgName={orgFilter || undefined} timeWindow={timeWindow} />
      </>
      )}

      {/* 网点详情抽屉 */}
      <RepairShopDrawer
        shop={selectedShop}
        timeWindow={timeWindow}
        onClose={() => setSelectedShop(null)}
      />
    </div>
  );
};

interface KpiCellProps {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}

const KpiCell: React.FC<KpiCellProps> = ({ label, value, sub, accent }) => (
  <div className={cardStyles.compact}>
    <div className={textStyles.caption}>{label}</div>
    <div className={cn('text-2xl font-kpi tabular-nums mt-1', accent)}>{value}</div>
    {sub && <div className={cn(textStyles.caption, 'mt-0.5')}>{sub}</div>}
  </div>
);

