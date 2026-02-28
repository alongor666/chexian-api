/**
 * 驾乘险推介率 - 时间维度汇总表格
 * Cross-Sell Time Period Summary Tables
 *
 * 展示推介率、驾乘件均、驾乘保费三个维度的当日/当周/当月/当年汇总数据
 */

import { memo } from 'react';
import type { AdvancedFilterState } from '@/shared/types/data';
import { Table } from '@/shared/ui/Table';
import type { TableColumn } from '@/shared/ui/Table';
import { textStyles, cn } from '@/shared/styles';
import { formatCount, formatPercent, formatDriverPremiumWan } from '@/shared/utils/formatters';
import { getRateClassByField } from './crossSellRateStatus';
import { useCrossSellTimePeriod } from './hooks/useCrossSellTimePeriod';
import type { VehicleCategory, TimePeriodRow } from './hooks/useCrossSellTimePeriod';

interface CrossSellTimePeriodSummaryProps {
  vehicleCategory: VehicleCategory;
  filters: AdvancedFilterState;
}

type TimePeriodRecord = TimePeriodRow & Record<string, unknown>;

function getTimePeriodRateClass(rate: number, label: string): string {
  if (label === '主全') return getRateClassByField('zhuquan_rate', rate);
  if (label === '交三') return getRateClassByField('jiaosan_rate', rate);
  return '';
}

const rateColumns: TableColumn<TimePeriodRecord>[] = [
  { key: 'label', title: '险别组合', dataIndex: 'label', align: 'left' },
  {
    key: 'day',
    title: '当日',
    dataIndex: 'day',
    align: 'right',
    render: (value, record) => {
      const rate = Number(value);
      const label = (record as TimePeriodRecord).label as string;
      const colorClass = getTimePeriodRateClass(rate, label);
      return <span className={cn(textStyles.numeric, colorClass)}>{formatPercent(rate)}</span>;
    },
  },
  {
    key: 'week',
    title: '当周',
    dataIndex: 'week',
    align: 'right',
    render: (value, record) => {
      const rate = Number(value);
      const label = (record as TimePeriodRecord).label as string;
      const colorClass = getTimePeriodRateClass(rate, label);
      return <span className={cn(textStyles.numeric, colorClass)}>{formatPercent(rate)}</span>;
    },
  },
  {
    key: 'month',
    title: '当月',
    dataIndex: 'month',
    align: 'right',
    render: (value, record) => {
      const rate = Number(value);
      const label = (record as TimePeriodRecord).label as string;
      const colorClass = getTimePeriodRateClass(rate, label);
      return <span className={cn(textStyles.numeric, colorClass)}>{formatPercent(rate)}</span>;
    },
  },
  {
    key: 'year',
    title: '当年',
    dataIndex: 'year',
    align: 'right',
    render: (value, record) => {
      const rate = Number(value);
      const label = (record as TimePeriodRecord).label as string;
      const colorClass = getTimePeriodRateClass(rate, label);
      return <span className={cn(textStyles.numeric, colorClass)}>{formatPercent(rate)}</span>;
    },
  },
];

const avgPremiumColumns: TableColumn<TimePeriodRecord>[] = [
  { key: 'label', title: '险别组合', dataIndex: 'label', align: 'left' },
  {
    key: 'day',
    title: '当日',
    dataIndex: 'day',
    align: 'right',
    render: (value) => <span className={textStyles.numeric}>{formatCount(Number(value))}</span>,
  },
  {
    key: 'week',
    title: '当周',
    dataIndex: 'week',
    align: 'right',
    render: (value) => <span className={textStyles.numeric}>{formatCount(Number(value))}</span>,
  },
  {
    key: 'month',
    title: '当月',
    dataIndex: 'month',
    align: 'right',
    render: (value) => <span className={textStyles.numeric}>{formatCount(Number(value))}</span>,
  },
  {
    key: 'year',
    title: '当年',
    dataIndex: 'year',
    align: 'right',
    render: (value) => <span className={textStyles.numeric}>{formatCount(Number(value))}</span>,
  },
];

const premiumColumns: TableColumn<TimePeriodRecord>[] = [
  { key: 'label', title: '险别组合', dataIndex: 'label', align: 'left' },
  {
    key: 'day',
    title: '当日',
    dataIndex: 'day',
    align: 'right',
    render: (value) => <span className={textStyles.numeric}>{formatDriverPremiumWan(Number(value) * 10000)}</span>,
  },
  {
    key: 'week',
    title: '当周',
    dataIndex: 'week',
    align: 'right',
    render: (value) => <span className={textStyles.numeric}>{formatDriverPremiumWan(Number(value) * 10000)}</span>,
  },
  {
    key: 'month',
    title: '当月',
    dataIndex: 'month',
    align: 'right',
    render: (value) => <span className={textStyles.numeric}>{formatDriverPremiumWan(Number(value) * 10000)}</span>,
  },
  {
    key: 'year',
    title: '当年',
    dataIndex: 'year',
    align: 'right',
    render: (value) => <span className={textStyles.numeric}>{formatDriverPremiumWan(Number(value) * 10000)}</span>,
  },
];

export const CrossSellTimePeriodSummary = memo(function CrossSellTimePeriodSummary({
  vehicleCategory,
  filters,
}: CrossSellTimePeriodSummaryProps) {
  const { maxDate, rateData, avgPremiumData, premiumData, loading, error } = useCrossSellTimePeriod({
    filters,
    vehicleCategory,
  });

  if (error) {
    return <p className={textStyles.caption}>加载失败: {error}</p>;
  }

  return (
    <div className="space-y-4">
      {maxDate && (
        <p className={textStyles.caption}>数据截至: {maxDate}</p>
      )}

      <div>
        <h3 className={cn(textStyles.titleSmall, 'mb-2')}>推介率</h3>
        <Table<TimePeriodRecord>
          columns={rateColumns}
          dataSource={rateData as TimePeriodRecord[]}
          rowKey="label"
          size="small"
          striped
          loading={loading}
        />
      </div>

      <div>
        <h3 className={cn(textStyles.titleSmall, 'mb-2')}>驾乘件均（元）</h3>
        <Table<TimePeriodRecord>
          columns={avgPremiumColumns}
          dataSource={avgPremiumData as TimePeriodRecord[]}
          rowKey="label"
          size="small"
          striped
          loading={loading}
        />
      </div>

      <div>
        <h3 className={cn(textStyles.titleSmall, 'mb-2')}>驾乘保费（万元）</h3>
        <Table<TimePeriodRecord>
          columns={premiumColumns}
          dataSource={premiumData as TimePeriodRecord[]}
          rowKey="label"
          size="small"
          striped
          loading={loading}
        />
      </div>
    </div>
  );
});

export default CrossSellTimePeriodSummary;
