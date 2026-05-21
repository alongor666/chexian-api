/**
 * 赔付率发展三角形 — 智能洞察卡片（薄壳：映射 iconKey + 委托 shared/InsightCard）
 */
import {
  AlertTriangle,
  BarChart3,
  Flame,
  Info,
  TrendingDown,
  TrendingUp,
  Waves,
  Zap,
} from 'lucide-react';
import { InsightCard as SharedInsightCard } from '../shared/InsightCard';
import type { LossRatioInsight } from './types';

const ICON_MAP = {
  alert: AlertTriangle,
  flame: Flame,
  trendUp: TrendingUp,
  trendDown: TrendingDown,
  shockwave: Waves,
  zap: Zap,
  compare: BarChart3,
  info: Info,
} as const;

export function LossRatioInsightCard({ insight }: { insight: LossRatioInsight }) {
  return (
    <SharedInsightCard
      severity={insight.severity}
      icon={ICON_MAP[insight.iconKey]}
      title={insight.title}
      body={insight.body}
      metricValue={insight.metricValue}
      metricLabel={insight.metricLabel}
    />
  );
}
