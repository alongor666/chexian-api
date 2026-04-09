import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { cardStyles, textStyles, tableStyles } from '@/shared/styles';
import { formatPremiumWan, formatPercent, formatCount } from '@/shared/utils/formatters';
import { cn } from '@/shared/styles';

interface RepairOverview {
  org_level_3: string;
  shop_count: number;
  shop_4s_count: number;
  active_count: number;
  total_damage_amount: number;
  avg_discount_rate: number;
  total_net_premium: number;
}

interface RepairStatus {
  cooperation_status: string;
  shop_count: number;
  total_net_premium: number;
}

export const RepairPage: React.FC = () => {
  const [orgFilter, setOrgFilter] = useState<string>('');
  const [is4sFilter, setIs4sFilter] = useState<string>('');

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (orgFilter) p.orgName = orgFilter;
    if (is4sFilter) p.is4sShop = is4sFilter;
    return p;
  }, [orgFilter, is4sFilter]);

  const { data: overview, isLoading: loadingOverview } = useQuery({
    queryKey: ['repair-overview', params],
    queryFn: () => apiClient.getRepairOverview(params) as Promise<RepairOverview[]>,
  });
  const { data: statusData } = useQuery({
    queryKey: ['repair-status', params],
    queryFn: () => apiClient.getRepairStatus(params) as Promise<RepairStatus[]>,
  });
  const { data: metadata } = useQuery({
    queryKey: ['repair-metadata'],
    queryFn: () => apiClient.getRepairMetadata() as Promise<{ orgs: string[]; statuses: string[]; total_shops: number }>,
  });

  const totalShops = overview?.reduce((s, r) => s + r.shop_count, 0) ?? 0;
  const total4s = overview?.reduce((s, r) => s + r.shop_4s_count, 0) ?? 0;
  const totalActive = overview?.reduce((s, r) => s + r.active_count, 0) ?? 0;
  const totalPremium = overview?.reduce((s, r) => s + r.total_net_premium, 0) ?? 0;

  return (
    <div className="space-y-4">
      {/* 标题 + 筛选 */}
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className={textStyles.titleMedium}>维修资源分析</h2>
        <select className="border border-neutral-200 rounded px-3 py-1.5 text-sm" value={orgFilter} onChange={e => setOrgFilter(e.target.value)}>
          <option value="">全部机构</option>
          {(metadata?.orgs ?? []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select className="border border-neutral-200 rounded px-3 py-1.5 text-sm" value={is4sFilter} onChange={e => setIs4sFilter(e.target.value)}>
          <option value="">全部类型</option>
          <option value="true">4S店</option>
          <option value="false">非4S店</option>
        </select>
      </div>

      {/* KPI 卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: '合作修理厂', value: formatCount(totalShops) },
          { label: '4S店', value: formatCount(total4s) },
          { label: '生效合作', value: formatCount(totalActive) },
          { label: '签单净保费', value: formatPremiumWan(totalPremium), unit: '万' },
        ].map(kpi => (
          <div key={kpi.label} className={cardStyles.compact}>
            <div className={textStyles.caption}>{kpi.label}</div>
            <div className={cn(textStyles.titleLarge, 'mt-1')}>{kpi.value}{kpi.unit && <span className={textStyles.caption}> {kpi.unit}</span>}</div>
          </div>
        ))}
      </div>

      {/* 机构汇总表 */}
      <div className={cardStyles.base}>
        <h3 className={textStyles.titleSmall}>机构维修资源汇总</h3>
        {loadingOverview ? (
          <div className={cn(textStyles.caption, 'py-8 text-center')}>加载中...</div>
        ) : (
          <div className={tableStyles.container}>
            <table className="w-full">
              <thead className={tableStyles.header}>
                <tr>
                  <th className={tableStyles.headerCell}>机构</th>
                  <th className={cn(tableStyles.headerCell, 'text-right')}>修理厂数</th>
                  <th className={cn(tableStyles.headerCell, 'text-right')}>4S店数</th>
                  <th className={cn(tableStyles.headerCell, 'text-right')}>生效合作</th>
                  <th className={cn(tableStyles.headerCell, 'text-right')}>核损金额(万)</th>
                  <th className={cn(tableStyles.headerCell, 'text-right')}>换件折扣率</th>
                  <th className={cn(tableStyles.headerCell, 'text-right')}>净保费(万)</th>
                </tr>
              </thead>
              <tbody>
                {(overview ?? []).map(row => (
                  <tr key={row.org_level_3} className="border-b border-neutral-100">
                    <td className={tableStyles.cell}>{row.org_level_3 ?? '未知'}</td>
                    <td className={tableStyles.cellNumeric}>{formatCount(row.shop_count)}</td>
                    <td className={tableStyles.cellNumeric}>{formatCount(row.shop_4s_count)}</td>
                    <td className={tableStyles.cellNumeric}>{formatCount(row.active_count)}</td>
                    <td className={tableStyles.cellNumeric}>{formatPremiumWan(row.total_damage_amount)}</td>
                    <td className={tableStyles.cellNumeric}>{formatPercent(row.avg_discount_rate * 100)}</td>
                    <td className={tableStyles.cellNumeric}>{formatPremiumWan(row.total_net_premium)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 合作状态分布 */}
      <div className={cardStyles.base}>
        <h3 className={textStyles.titleSmall}>合作状态分布</h3>
        <div className={tableStyles.container}>
          <table className="w-full">
            <thead className={tableStyles.header}>
              <tr>
                <th className={tableStyles.headerCell}>合作状态</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>修理厂数</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>净保费(万)</th>
              </tr>
            </thead>
            <tbody>
              {(statusData ?? []).map(row => (
                <tr key={row.cooperation_status} className="border-b border-neutral-100">
                  <td className={tableStyles.cell}>{row.cooperation_status ?? '未知'}</td>
                  <td className={tableStyles.cellNumeric}>{formatCount(row.shop_count)}</td>
                  <td className={tableStyles.cellNumeric}>{formatPremiumWan(row.total_net_premium)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
