import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import {
  cardStyles,
  textStyles,
  tableStyles,
  badgeStyles,
  colorClasses,
  cn,
} from '@/shared/styles';
import { formatPremiumWan, formatPercent, formatCount } from '@/shared/utils/formatters';
import type { ScatterShopPoint } from './RepairScatter';

interface Props {
  shop: ScatterShopPoint | null;
  timeWindow: string;
  onClose: () => void;
}

interface LocalResourceRow {
  shop_code: string;
  shop_name: string;
  org_level_3: string | null;
  shop_district: string | null;
  total_claims: number;
  local_claims: number;
  local_resource_ratio: number | null;
}

interface ToPremiumRow {
  shop_code: string;
  shop_name: string;
  org_level_3: string | null;
  coop_tier: string;
  damage_amount: number;
  net_premium: number;
  repair_to_premium_ratio: number | null;
}

const TIER_BADGE: Record<string, { label: string; cls: string }> = {
  active: { label: '已合作', cls: cn(badgeStyles.base, badgeStyles.success) },
  past: { label: '曾合作', cls: cn(badgeStyles.base, badgeStyles.warning) },
  none: { label: '未合作', cls: cn(badgeStyles.base, badgeStyles.default) },
  none_shadow: { label: '影子网点', cls: cn(badgeStyles.base, badgeStyles.danger) },
};

export const RepairShopDrawer: React.FC<Props> = ({ shop, timeWindow, onClose }) => {
  const shopCode = shop?.shop_code ?? '';

  const { data: localRes } = useQuery({
    queryKey: ['repair-local-resource-shop', shopCode, timeWindow],
    queryFn: () =>
      apiClient.repair.localResource({
        shopCode,
        timeWindow,
      }) as Promise<LocalResourceRow[]>,
    enabled: Boolean(shopCode) && shop?.coop_tier !== 'none_shadow',
  });

  const { data: toPremium } = useQuery({
    queryKey: ['repair-to-premium-shop', shopCode, timeWindow],
    queryFn: () =>
      apiClient.repair.toPremium({
        shopCode,
        timeWindow,
      }) as Promise<ToPremiumRow[]>,
    enabled: Boolean(shopCode) && shop?.coop_tier !== 'none_shadow',
  });

  if (!shop) return null;

  const tier = TIER_BADGE[shop.coop_tier] ?? TIER_BADGE.none;
  const localRow = (localRes ?? []).find(r => r.shop_code === shopCode);
  const toPRow = (toPremium ?? []).find(r => r.shop_code === shopCode);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div
        className="absolute inset-0 bg-neutral-900/40"
        onClick={onClose}
        aria-hidden
      />
      <div
        className={cn(
          cardStyles.base,
          'relative w-full max-w-xl h-full overflow-auto p-5 rounded-none rounded-l-lg z-10',
        )}
      >
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className={textStyles.titleMedium}>{shop.shop_name ?? shop.shop_code}</h3>
              <span className={tier.cls}>{tier.label}</span>
              {shop.is_4s_shop && (
                <span className={cn(badgeStyles.base, badgeStyles.primary)}>4S店</span>
              )}
            </div>
            <div className={cn(textStyles.caption, 'mt-1')}>
              {(shop.org_level_3 ?? '—')} · {(shop.district ?? '—')}
              {shop.city ? ` · ${shop.city}` : ''}
            </div>
          </div>
          <button
            className={cn(
              textStyles.link,
              'px-2 py-1 text-sm',
            )}
            onClick={onClose}
          >
            关闭
          </button>
        </div>

        {/* KPI 栏 */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className={cardStyles.compact}>
            <div className={textStyles.caption}>签单净保费</div>
            <div className={cn(textStyles.titleSmall, 'font-numeric tabular-nums mt-1')}>
              {formatPremiumWan(shop.net_premium)} 万
            </div>
          </div>
          <div className={cardStyles.compact}>
            <div className={textStyles.caption}>核损金额</div>
            <div className={cn(textStyles.titleSmall, 'font-numeric tabular-nums mt-1')}>
              {formatPremiumWan(shop.damage_amount)} 万
            </div>
          </div>
          <div className={cardStyles.compact}>
            <div className={textStyles.caption}>修保比</div>
            <div className={cn(textStyles.titleSmall, 'font-numeric tabular-nums mt-1')}>
              {toPRow?.repair_to_premium_ratio != null
                ? toPRow.repair_to_premium_ratio.toFixed(3)
                : '—'}
            </div>
          </div>
        </div>

        {/* 本地资源占比 */}
        {shop.coop_tier !== 'none_shadow' && (
          <div className={cn(cardStyles.standard, 'mb-4')}>
            <h4 className={cn(textStyles.titleSmall, 'mb-2')}>本地资源占比</h4>
            {localRow ? (
              <div className={tableStyles.container}>
                <table className="w-full">
                  <tbody>
                    <tr className="border-b border-neutral-100">
                      <td className={tableStyles.cell}>赔案总数</td>
                      <td className={tableStyles.cellNumeric}>
                        {formatCount(localRow.total_claims)}
                      </td>
                    </tr>
                    <tr className="border-b border-neutral-100">
                      <td className={tableStyles.cell}>本区县赔案</td>
                      <td className={tableStyles.cellNumeric}>
                        {formatCount(localRow.local_claims)}
                      </td>
                    </tr>
                    <tr>
                      <td className={tableStyles.cell}>本地资源占比</td>
                      <td
                        className={cn(
                          tableStyles.cellNumeric,
                          colorClasses.text.primaryDark,
                        )}
                      >
                        {localRow.local_resource_ratio != null
                          ? formatPercent(localRow.local_resource_ratio * 100)
                          : '—'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={cn(textStyles.caption, 'py-3 text-center')}>
                该时间窗口无赔案数据
              </div>
            )}
          </div>
        )}

        {/* 导流提示 */}
        {(shop.coop_tier === 'past' || shop.coop_tier === 'none' || shop.coop_tier === 'none_shadow') && (
          <div
            className={cn(
              cardStyles.standard,
              shop.coop_tier === 'none_shadow'
                ? 'bg-danger-bg border-danger-border'
                : 'bg-warning-bg border-warning-border',
            )}
          >
            <h4 className={cn(textStyles.titleSmall, 'mb-1')}>导流建议</h4>
            <p className={textStyles.caption}>
              {shop.coop_tier === 'past' &&
                '该网点曾合作但已中止。建议核实终止原因，优先恢复合作或转移客户至同区县已合作网点。'}
              {shop.coop_tier === 'none' &&
                '该网点登记未合作。可评估合作潜力，或针对客户推送就近已合作网点名单。'}
              {shop.coop_tier === 'none_shadow' &&
                '该网点仅在理赔明细中出现，资源库尚未登记。优先补录网点档案，评估是否纳入合作体系。'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
