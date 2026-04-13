import React, { useState, useEffect } from 'react';
import { cn, colorClasses } from '@/shared/styles';

/**
 * VPS 数据维护通知横幅
 * 维护结束时间到达后自动隐藏
 */

const MAINTENANCE_END = new Date('2026-04-14T14:00:00+08:00');

export const MaintenanceBanner: React.FC = () => {
  const [visible, setVisible] = useState(() => Date.now() < MAINTENANCE_END.getTime());

  useEffect(() => {
    if (!visible) return;
    const remaining = MAINTENANCE_END.getTime() - Date.now();
    if (remaining <= 0) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(false), remaining);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className={cn(
        'flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium',
        'bg-warning-bg border-b border-warning-border',
        colorClasses.text.warningDark,
      )}
    >
      <span>&#9888;&#65039;</span>
      <span>
        VPS 数据已被开发者屏蔽，服务暂停中。预计恢复时间：
        <strong>4 月 14 日 14:00</strong>
      </span>
    </div>
  );
};
