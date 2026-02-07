import React from 'react';

interface GrowthMonthTabsProps {
  selectedMonth: number;
  onSelectMonth: (month: number) => void;
}

export function GrowthMonthTabs(props: GrowthMonthTabsProps): React.ReactElement {
  return (
    <div style={{ marginBottom: '16px', borderBottom: '1px solid #dee2e6' }}>
      <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', paddingBottom: '2px' }}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
          <button
            key={month}
            onClick={() => props.onSelectMonth(month)}
            style={{
              padding: '8px 16px',
              borderRadius: '6px 6px 0 0',
              border: 'none',
              backgroundColor: props.selectedMonth === month ? '#3b82f6' : 'transparent',
              color: props.selectedMonth === month ? '#ffffff' : '#6c757d',
              cursor: 'pointer',
              fontWeight: props.selectedMonth === month ? '600' : 'normal',
              transition: 'all 0.2s',
            }}
          >
            {month}月
          </button>
        ))}
      </div>
    </div>
  );
}

