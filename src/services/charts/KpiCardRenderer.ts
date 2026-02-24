import type { KPISummary } from '@/types/data.types';
import type { KPICardData } from '@/types/chart.types';
import type { Logger } from '../../shared/utils/logger';
import { formatPremiumWan, formatRate, formatCount } from '../../shared/utils/formatters';

const formatValue = (value: number, unit?: string): string => {
  if (unit === '元') {
    if (value >= 100000000) {
      return `${(value / 100000000).toFixed(2)} 亿${unit}`;
    }
    return formatPremiumWan(value).replace('万', ` 万${unit}`);
  }
  if (unit === '%') {
    return formatRate(value / 100);
  }
  return `${formatCount(value)}${unit || ''}`;
};

const injectKPICardStyles = () => {
  const styleId = 'kpi-cards-style';
  if (document.getElementById(styleId)) {
    return;
  }

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .kpi-cards-container {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      padding: 16px;
    }

    .kpi-card {
      background: white;
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      transition: transform 0.2s, box-shadow 0.2s;
      border-left: 4px solid #ccc;
    }

    .kpi-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .kpi-card--good {
      border-left-color: #52c41a;
    }

    .kpi-card--warning {
      border-left-color: #faad14;
    }

    .kpi-card--danger {
      border-left-color: #f5222d;
    }

    .kpi-card__label {
      font-size: 14px;
      color: #666;
      margin-bottom: 8px;
    }

    .kpi-card__value {
      font-size: 24px;
      font-weight: bold;
      color: #333;
      margin-bottom: 4px;
    }

    .kpi-card__threshold {
      font-size: 12px;
      color: #999;
    }
  `;
  document.head.appendChild(style);
};

const escapeHtml = (str: string): string =>
  String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const renderKPICards = (kpiData: KPISummary, container: HTMLElement, logger: Logger): void => {
  const cards: KPICardData[] = [
    {
      label: '签单保费',
      value: kpiData.签单保费,
      unit: '元',
      status: kpiData.签单保费 > 0 ? 'good' : 'warning',
    },
    {
      label: '变动成本率',
      value: kpiData.变动成本率,
      unit: '%',
      threshold: 100,
      status: kpiData.变动成本率 < 100 ? 'good' : kpiData.变动成本率 < 105 ? 'warning' : 'danger',
    },
    {
      label: '满期赔付率',
      value: kpiData.满期赔付率,
      unit: '%',
      threshold: 75,
      status: kpiData.满期赔付率 < 75 ? 'good' : kpiData.满期赔付率 < 85 ? 'warning' : 'danger',
    },
    {
      label: '费用率',
      value: kpiData.费用率,
      unit: '%',
      threshold: 20,
      status: kpiData.费用率 < 20 ? 'good' : kpiData.费用率 < 25 ? 'warning' : 'danger',
    },
    {
      label: '边际贡献额',
      value: kpiData.边际贡献额,
      unit: '元',
      status: kpiData.边际贡献额 > 0 ? 'good' : 'danger',
    },
  ];

  const html = `
    <div class="kpi-cards-container">
      ${cards
        .map(
          (card) => `
        <div class="kpi-card kpi-card--${escapeHtml(card.status ?? '')}">
          <div class="kpi-card__label">${escapeHtml(card.label)}</div>
          <div class="kpi-card__value">
            ${escapeHtml(formatValue(card.value, card.unit))}
          </div>
          ${card.threshold !== undefined ? `
            <div class="kpi-card__threshold">阈值: ${escapeHtml(String(card.threshold))}${escapeHtml(card.unit ?? '')}</div>
          ` : ''}
        </div>
      `
        )
        .join('')}
    </div>
  `;

  container.innerHTML = html;
  injectKPICardStyles();
  logger.debug('KPI 卡片渲染成功');
};
