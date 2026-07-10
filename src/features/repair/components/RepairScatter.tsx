import React, { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { echarts } from '@/shared/utils/echarts';
import { getChartTheme } from '@/shared/config/chartStyles';
import { useTheme } from '@/shared/theme';
import { cardStyles, textStyles, cn } from '@/shared/styles';
import { formatPremiumWan } from '@/shared/utils/formatters';
import { buildScatterAxes, scatterSymbolSize, buildTierSeriesData } from '../utils/repairScatter';
import type { EChartsParam } from '@/shared/types/echarts';

export interface ScatterShopPoint {
  shop_code: string;
  shop_name: string;
  org_level_3: string | null;
  district: string | null;
  city: string | null;
  coop_tier: 'active' | 'past' | 'none' | 'none_shadow';
  is_4s_shop: boolean;
  damage_amount: number;
  net_premium: number;
}

interface Props {
  data: ScatterShopPoint[];
  loading?: boolean;
  onPointClick?: (shop: ScatterShopPoint) => void;
}

const TIER_COLOR: Record<ScatterShopPoint['coop_tier'], string> = {
  active: '#52c41a',
  past: '#faad14',
  none: '#bfbfbf',
  none_shadow: '#ff4d4f',
};

const TIER_LABEL: Record<ScatterShopPoint['coop_tier'], string> = {
  active: '已合作',
  past: '曾合作',
  none: '未合作',
  none_shadow: '影子网点',
};

export const RepairScatter: React.FC<Props> = ({ data, loading, onPointClick }) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const { option } = useMemo(() => {
    const theme = getChartTheme(isDark);
    const { districtList: dList, orgList: oList } = buildScatterAxes(data);

    const series = (['active', 'past', 'none', 'none_shadow'] as const).map(tier => ({
      name: TIER_LABEL[tier],
      type: 'scatter' as const,
      symbolSize: (d: [number, number, number]) => scatterSymbolSize(d[2]),
      itemStyle: {
        color: TIER_COLOR[tier],
        opacity: tier === 'none' ? 0.55 : 0.85,
        borderColor: '#fff',
        borderWidth: 1,
      },
      data: buildTierSeriesData(data, tier, dList, oList),
    }));

    const opt = {
      tooltip: {
        ...theme.tooltipConfig,
        formatter: (params: EChartsParam) => {
          const shop = (params.data as { shop?: ScatterShopPoint })?.shop;
          if (!shop) return '';
          return [
            `<div style="font-weight:600">${shop.shop_name ?? shop.shop_code}</div>`,
            `合作状态：${TIER_LABEL[shop.coop_tier]}`,
            `机构：${shop.org_level_3 ?? '—'}`,
            `区县：${shop.district ?? '—'}`,
            `净保费：${formatPremiumWan(shop.net_premium)} 万`,
            `核损金额：${formatPremiumWan(shop.damage_amount)} 万`,
          ].join('<br/>');
        },
      },
      legend: {
        data: (['active', 'past', 'none', 'none_shadow'] as const).map(t => TIER_LABEL[t]),
        top: 0,
        textStyle: theme.chartTextStyles.legend,
      },
      grid: { left: 120, right: 32, top: 40, bottom: 80, containLabel: true },
      xAxis: {
        type: 'category',
        data: dList,
        name: '区县',
        nameGap: 28,
        axisLabel: { rotate: 45, ...theme.chartTextStyles.axisLabel },
      },
      yAxis: {
        type: 'category',
        data: oList,
        name: '机构',
        axisLabel: theme.chartTextStyles.axisLabel,
      },
      series,
    };
    return { option: opt };
  }, [data, isDark]);

  const onEvents = useMemo(
    () => ({
      click: (params: EChartsParam) => {
        const shop = (params?.data as { shop?: ScatterShopPoint })?.shop;
        if (shop && onPointClick) onPointClick(shop);
      },
    }),
    [onPointClick],
  );

  if (loading) {
    return (
      <div className={cn(cardStyles.standard, 'h-[420px] flex items-center justify-center')}>
        <span className={textStyles.caption}>加载中...</span>
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className={cn(cardStyles.standard, 'h-[420px] flex items-center justify-center')}>
        <span className={textStyles.caption}>暂无数据</span>
      </div>
    );
  }

  return (
    <div className={cardStyles.standard}>
      <div className="flex items-center justify-between mb-2">
        <h3 className={textStyles.titleSmall}>区县 × 机构 合作网点分布</h3>
        <span className={textStyles.caption}>点击气泡查看网点详情 · 气泡大小=净保费</span>
      </div>
      <ReactEChartsCore
        echarts={echarts}
        option={option}
        onEvents={onEvents}
        style={{ height: 440, width: '100%' }}
        notMerge
      />
    </div>
  );
};
