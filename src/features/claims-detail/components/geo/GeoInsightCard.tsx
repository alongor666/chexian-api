/**
 * 地理风险热力图 — 洞察卡片（薄壳：映射 iconKey + 委托 shared/InsightCard）
 */
import { AlertTriangle, Building2, MapPin, TrendingUp } from 'lucide-react';
import { InsightCard as SharedInsightCard } from '../shared/InsightCard';
import type { GeoInsight } from './types';

const ICON_MAP = {
  alert: AlertTriangle,
  pin: MapPin,
  trend: TrendingUp,
  building: Building2,
} as const;

export function GeoInsightCard({ insight }: { insight: GeoInsight }) {
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
