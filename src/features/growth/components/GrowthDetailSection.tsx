import React from 'react';
import { GrowthKpiCards } from './GrowthKpiCards';
import { ScissorsTrendChart } from '../../../charts/ScissorsTrendChart';
import { formatPercent1, getSafeDateStr } from '../utils/format';
import type { GrowthAnalysisType } from './GrowthAnalysisControlPanel';
import { StickyTableFrame } from '../../../shared/ui';
import { cn, getTrendColorClass, stickyTableStyles } from '../../../shared/styles';

interface GrowthDetailSectionProps {
  analysisType: GrowthAnalysisType;
  displayData: any[];
  data: any[];
  isDailyDetailMode: boolean;
  isPremiumPerspective: boolean;
  cutoffDateStr: string;
  selectedMonth: number;
  valueLabel: string;
  unitLabel: string;
  formatValueNoUnit: (val: number | null | undefined) => string;
  onDownload: () => void;
}

export function GrowthDetailSection(props: GrowthDetailSectionProps): React.ReactElement | null {
  if (props.displayData.length === 0) return null;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        {!props.isDailyDetailMode ? <h3 style={{ margin: 0 }}>详细数据</h3> : <div />}
        <button
          onClick={props.onDownload}
          style={{
            padding: '6px 12px',
            backgroundColor: '#fff',
            border: '1px solid #d9d9d9',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          📥 下载数据
        </button>
      </div>

      {props.isDailyDetailMode && props.isPremiumPerspective && (
        <GrowthKpiCards
          data={props.data}
          cutoffDate={props.cutoffDateStr}
          valueFormatter={props.formatValueNoUnit}
          unitLabel={props.unitLabel}
        />
      )}

      {props.isDailyDetailMode && props.isPremiumPerspective && (
        <div style={{ marginBottom: '24px' }}>
          <ScissorsTrendChart
            data={props.displayData.map(item => ({
              date: item.time_period || '',
              current_ytd: (item.ytd_total_current || 0) / 10000,
              last_year_ytd: (item.ytd_total_previous || 0) / 10000,
              current_day: (item.current_value || 0) / 10000, // 透传当日保费
            }))}
            selectedDate={props.cutoffDateStr}
            // 找到全量的最新签单日
            latestSignedDate={(() => {
              const latest = [...props.data].reverse().find(d => (d.current_value || 0) > 0);
              return latest?.time_period || undefined;
            })()}
            height={400}
          />
        </div>
      )}

      <StickyTableFrame maxHeight={520}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr>
              <th
                className={stickyTableStyles.firstColumnHeader}
                style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #ddd' }}
              >
                {props.isDailyDetailMode ? '日期' : props.analysisType === 'org' ? '机构' : props.analysisType === 'salesman' ? '业务员' : '时间'}
              </th>
              <th className={stickyTableStyles.header} style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #ddd' }}>
                {props.isDailyDetailMode ? `当年当日${props.valueLabel}` : `当期${props.valueLabel}`}
              </th>
              <th className={stickyTableStyles.header} style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #ddd' }}>
                {props.isDailyDetailMode ? `上年当日${props.valueLabel}` : `基期${props.valueLabel}`}
              </th>
              <th className={stickyTableStyles.header} style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #ddd' }}>
                {props.isDailyDetailMode ? '日增速' : '增长率'}
              </th>
              {props.isDailyDetailMode && (
                <>
                  <th className={stickyTableStyles.header} style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #ddd' }}>
                    当年当月累计{props.valueLabel}
                  </th>
                  <th className={stickyTableStyles.header} style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #ddd' }}>
                    上年当月累计{props.valueLabel}
                  </th>
                  <th className={stickyTableStyles.header} style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #ddd' }}>当月增速</th>
                  <th className={stickyTableStyles.header} style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #ddd' }}>
                    当年累计{props.valueLabel}
                  </th>
                  <th className={stickyTableStyles.header} style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #ddd' }}>
                    上年累计{props.valueLabel}
                  </th>
                  <th className={stickyTableStyles.header} style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #ddd' }}>当年增速</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {props.displayData.map((item, index) => {
              const dateStr = getSafeDateStr(item.time_period);
              const isAfterCutoff = dateStr > props.cutoffDateStr;
              const isCutoffDay = dateStr === props.cutoffDateStr;

              const displayLabel = props.isDailyDetailMode
                ? item.time_period
                  ? dateStr.substring(5)
                  : '-'
                : item.time_period
                  ? dateStr.substring(5)
                  : item.salesman_name || item.org_level_3 || '-';

              return (
                <tr
                  key={index}
                  style={{
                    borderBottom: '1px solid #eee',
                    opacity: isAfterCutoff ? 0.5 : 1,
                    backgroundColor: isCutoffDay ? '#e0f2fe' : 'transparent',
                  }}
                >
                  <td
                    className={stickyTableStyles.firstColumn}
                    style={{ padding: '12px', fontWeight: isAfterCutoff ? 'normal' : 'inherit' }}
                  >
                    {displayLabel}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right', fontWeight: isAfterCutoff ? 'normal' : 'inherit' }}>
                    {props.formatValueNoUnit(item.current_value)}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right', fontWeight: isAfterCutoff ? 'normal' : 'inherit' }}>
                    {props.formatValueNoUnit(item.previous_value)}
                  </td>
                  <td
                    className={cn(getTrendColorClass(item.growth_rate || 0, 'positive'), isAfterCutoff ? '' : 'font-medium')}
                    style={{
                      padding: '12px',
                      textAlign: 'right',
                    }}
                  >
                    {formatPercent1(item.growth_rate)}
                  </td>

                  {props.isDailyDetailMode && (
                    <>
                      <td style={{ padding: '12px', textAlign: 'right', fontWeight: isAfterCutoff ? 'normal' : '500' }}>
                        {props.formatValueNoUnit(item.period_total_current)}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right', fontWeight: isAfterCutoff ? 'normal' : 'inherit' }}>
                        {props.formatValueNoUnit(item.period_total_previous)}
                      </td>
                      <td
                        className={cn(getTrendColorClass(item.period_growth_rate || 0, 'positive'), isAfterCutoff ? '' : 'font-bold')}
                        style={{
                          padding: '12px',
                          textAlign: 'right',
                        }}
                      >
                        {formatPercent1(item.period_growth_rate)}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right', fontWeight: isAfterCutoff ? 'normal' : '500' }}>
                        {props.formatValueNoUnit(item.ytd_total_current)}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right', fontWeight: isAfterCutoff ? 'normal' : 'inherit' }}>
                        {props.formatValueNoUnit(item.ytd_total_previous)}
                      </td>
                      <td
                        className={cn(getTrendColorClass(item.ytd_growth_rate || 0, 'positive'), isAfterCutoff ? '' : 'font-bold')}
                        style={{
                          padding: '12px',
                          textAlign: 'right',
                        }}
                      >
                        {formatPercent1(item.ytd_growth_rate)}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </StickyTableFrame>
    </div>
  );
}
