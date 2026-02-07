import React from 'react';

export const formatDateToISO = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

interface DateRangePickerProps {
  startDate?: string;
  endDate?: string;
  onChange: (start?: string, end?: string) => void;
  /**
   * DC-001: 动态标签（支持日期口径切换）
   *
   * @example
   * // 签单日期口径
   * labels={{ start: '签单日期起始', end: '签单日期截止' }}
   *
   * // 起保日期口径
   * labels={{ start: '起保日期起始', end: '起保日期截止' }}
   */
  labels?: {
    start: string;
    end: string;
  };
  /** 紧凑模式（垂直布局，适用于侧边栏） */
  compact?: boolean;
}

export const DateRangePicker: React.FC<DateRangePickerProps> = ({
  startDate,
  endDate,
  onChange,
  compact = false,
}) => {
  const startValue = startDate ?? '';
  const endValue = endDate ?? '';

  const summaryText =
    startValue && endValue
      ? `${startValue} ~ ${endValue}`
      : startValue
        ? `${startValue} ~`
        : endValue
          ? `~ ${endValue}`
          : '全部';

  const handleStartChange = (value: string) => {
    const nextStart = value.trim();
    const nextStartValue = nextStart === '' ? undefined : nextStart;

    if (!nextStartValue) {
      onChange(undefined, undefined);
      return;
    }

    const nextEndValue = endValue && endValue >= nextStartValue ? endValue : nextStartValue;
    onChange(nextStartValue, nextEndValue);
  };

  const handleEndChange = (value: string) => {
    const nextEnd = value.trim();
    const nextEndValue = nextEnd === '' ? undefined : nextEnd;
    onChange(startValue === '' ? undefined : startValue, nextEndValue);
  };

  // 紧凑模式：垂直堆叠布局
  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-gray-600">起止日期</label>
          <span className="text-[10px] text-gray-400">{summaryText}</span>
        </div>
        <div className="space-y-1.5">
          <input
            type="date"
            value={startValue}
            onChange={(e) => handleStartChange(e.target.value)}
            className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded"
            aria-label="起始日"
          />
          <input
            type="date"
            value={endValue}
            min={startValue || undefined}
            disabled={!startValue}
            onChange={(e) => handleEndChange(e.target.value)}
            className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded disabled:bg-gray-100"
            aria-label="截止日"
          />
        </div>
      </div>
    );
  }

  return (
    <details className="group rounded-lg border border-gray-200 bg-white">
      <summary className="list-none cursor-pointer px-3 py-2 flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-gray-700 whitespace-nowrap">起止日期</span>
        <span className="text-sm text-gray-500 truncate">{summaryText}</span>
      </summary>
      <div className="px-3 pb-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="text-xs text-gray-500 whitespace-nowrap">起始日</div>
            <input
              type="date"
              value={startValue}
              onChange={(e) => handleStartChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              aria-label="起始日"
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-gray-500 whitespace-nowrap">截止日</div>
            <input
              type="date"
              value={endValue}
              min={startValue || undefined}
              disabled={!startValue}
              onChange={(e) => handleEndChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm disabled:bg-gray-100"
              aria-label="截止日"
            />
          </div>
        </div>
      </div>
    </details>
  );
};
