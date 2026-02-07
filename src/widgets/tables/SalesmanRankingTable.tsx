import React from 'react';
import { VirtualTable } from '../table/VirtualTable';

export interface SalesmanRankingRow {
  salesman_name: string;
  org_level_3: string;
  total_premium: string;
  policy_count: number;
}

interface SalesmanRankingTableProps {
  title: string;
  premiumLabel: string;
  data: SalesmanRankingRow[];
  loading: boolean;
  actions?: React.ReactNode;
}

export const SalesmanRankingTable: React.FC<SalesmanRankingTableProps> = ({
  title,
  premiumLabel,
  data,
  loading,
  actions,
}) => {
  return (
    <div className="bg-white rounded shadow p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
        <h3 className="text-base font-semibold">{title}</h3>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <VirtualTable
        columns={[
          { key: 'salesman_name', header: '业务员', width: 120 },
          { key: 'org_level_3', header: '三级机构', width: 150 },
          { key: 'total_premium', header: premiumLabel, width: 120 },
          { key: 'policy_count', header: '保单数', width: 100 },
        ]}
        data={data}
        loading={loading}
      />
    </div>
  );
};
