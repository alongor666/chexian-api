import React from 'react';
import { formatSalesmanName } from '../../shared/utils/formatters';
import { cardStyles, tableStyles, fontStyles, cn } from '../../shared/styles';

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
  /** 表格主色调：全部业务=primary（蓝），优质业务=success（绿） */
  tone?: 'primary' | 'success';
}

/** tone → hex（数据条 rgba 与 chip 使用） */
const TONE_RGB: Record<'primary' | 'success', string> = {
  primary: '24,144,255',
  success: '82,196,26',
};

/** tone → chip 前 3 名文字强调色 */
const TONE_STRONG_COLOR: Record<'primary' | 'success', string> = {
  primary: '#0958d9',
  success: '#389e0d',
};

/** tone → 表头竖色条 hex */
const TONE_HEX: Record<'primary' | 'success', string> = {
  primary: '#1890ff',
  success: '#52c41a',
};

export const SalesmanRankingTable: React.FC<SalesmanRankingTableProps> = ({
  title,
  premiumLabel,
  data,
  loading,
  actions,
  tone = 'primary',
}) => {
  const toneRgb = TONE_RGB[tone];
  const toneStrongColor = TONE_STRONG_COLOR[tone];
  const toneHex = TONE_HEX[tone];

  // 计算本表保费最大值（total_premium 是带千分位的字符串，需去逗号后转数值）
  const premiumNumbers = data.map((r) => parseFloat(r.total_premium.replace(/,/g, '')) || 0);
  const maxPremium = premiumNumbers.length > 0 ? Math.max(...premiumNumbers) : 0;

  return (
    <div className={cn(cardStyles.base, 'overflow-hidden')}>
      {/* 表头区：左侧 tone 竖色条 + 标题 + 导出操作 */}
      <div className={cn(
        'flex items-center justify-between border-b border-neutral-200 dark:border-subtle',
        'bg-neutral-50 dark:bg-surface-2 px-4 py-3'
      )}>
        <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-neutral-800 dark:text-neutral-200">
          {/* tone 竖色条 */}
          <span
            className="inline-block w-1 h-3.5 rounded-sm flex-shrink-0"
            style={{ background: toneHex }}
            aria-hidden="true"
          />
          {title}
        </h3>
        {actions ? (
          <div className="flex flex-wrap gap-2">{actions}</div>
        ) : null}
      </div>

      {/* 加载态骨架 */}
      {loading ? (
        <div className="px-4 py-6 text-center text-sm text-neutral-400 dark:text-neutral-500">
          加载中…
        </div>
      ) : data.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-neutral-400 dark:text-neutral-500">
          暂无数据
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className={tableStyles.header}>
                <th className={cn(tableStyles.headerCell, 'text-left w-2/5')}>业务员</th>
                <th className={cn(tableStyles.headerCell, 'text-left')}>三级机构</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>{premiumLabel}</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>保单数</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => {
                const premiumNum = premiumNumbers[i];
                const barPct = maxPremium > 0 ? (premiumNum / maxPremium) * 100 : 0;
                const isTop3 = i < 3;

                return (
                  <tr
                    key={`${row.salesman_name}-${i}`}
                    className={tableStyles.row}
                  >
                    {/* 业务员列：排名 chip + 姓名 */}
                    <td className={cn(tableStyles.cell, 'font-medium text-neutral-800 dark:text-neutral-200')}>
                      <span className="inline-flex items-center gap-2">
                        {/* 排名 chip */}
                        <span
                          className="inline-flex items-center justify-center w-4 h-4 rounded text-[10px] font-bold leading-none flex-shrink-0"
                          style={isTop3
                            ? {
                                background: `rgba(${toneRgb}, 0.14)`,
                                color: toneStrongColor,
                              }
                            : {
                                background: 'transparent',
                                color: '#bfbfbf',
                              }
                          }
                        >
                          {i + 1}
                        </span>
                        <span className={cn(isTop3 ? 'font-semibold' : '')}>
                          {formatSalesmanName(row.salesman_name)}
                        </span>
                      </span>
                    </td>

                    {/* 三级机构列 */}
                    <td className={cn(tableStyles.cell, 'text-neutral-500 dark:text-neutral-400 text-xs')}>
                      {row.org_level_3}
                    </td>

                    {/* 保费列：单元格内数据条 */}
                    <td className={cn(tableStyles.cell, 'text-right')}>
                      <div
                        style={{
                          position: 'relative',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                        }}
                      >
                        {/* 数据条（绝对定位，居中纵向） */}
                        <div
                          style={{
                            position: 'absolute',
                            right: 0,
                            top: '21%',
                            height: '58%',
                            borderRadius: 2,
                            width: `${barPct}%`,
                            background: `rgba(${toneRgb}, 0.20)`,
                          }}
                          aria-hidden="true"
                        />
                        {/* 数字叠在数据条上方 */}
                        <span
                          className={cn(fontStyles.numeric, 'relative text-neutral-800 dark:text-neutral-200')}
                          style={{ fontSize: '13px' }}
                        >
                          {row.total_premium}
                        </span>
                      </div>
                    </td>

                    {/* 保单数列 */}
                    <td
                      className={cn(
                        tableStyles.cell,
                        fontStyles.numeric,
                        'text-right text-neutral-500 dark:text-neutral-400'
                      )}
                      style={{ fontSize: '13px' }}
                    >
                      {row.policy_count.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
