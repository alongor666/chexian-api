/**
 * 筛选器联动防复发（治理计划 Phase 5，✅D6=A：断言网络请求参数，不断言数据值）
 *
 * 2026-06-10 全站审计的 4 个病灶页，逐页断言：
 * 1. chip 集合与能力矩阵一致（不可表达的 chip 被隐藏，防「点了报错/点了没用」复发）；
 * 2. 点 chip 后发出的请求 query 含对应维度参数（防「点了数据不动」的漏接复发）。
 *
 * 数据值随每日 ETL 变化，故只断言参数（✅D6 拍板）；数据正确性由
 * scripts/ad-hoc/reconcile-* 复盘脚本与各 Phase 的 curl 分割对账兜底。
 * 矩阵唯一事实源：src/shared/config/filter-dimension-capability.ts。
 */
import { test, expect, type Page } from '@playwright/test';
import { skipWhenNoData } from './helpers/session';

interface ChipInteraction {
  /** 点击前 toggle/chip 显示的文本（循环 toggle 取初始档文本） */
  chip: string;
  /** 期待发出的请求 URL 模式 */
  api: RegExp;
  /** 请求 query 必须包含的参数与值（URL 解码后匹配） */
  param: string;
  value: string;
}

interface PageSpec {
  name: string;
  url: string;
  /** 能力矩阵应隐藏的 chip/toggle 文本（精确匹配） */
  hiddenChips: string[];
  /** 应可见的 chip/toggle 文本（防过度隐藏） */
  visibleChips: string[];
  interactions: ChipInteraction[];
}

const PAGES: PageSpec[] = [
  {
    name: 'growth 增长页（policy_fact 全维度；BACKLOG 42fe4a 复发哨兵）',
    url: '/#/growth',
    hiddenChips: [],
    visibleChips: ['交/商', '油/气/电', '1T货', 'X自卸'],
    interactions: [
      // 42fe4a 根因：insurance_type 漏拷 → 交/商 chip 不联动
      { chip: '交/商', api: /\/api\/query\/growth/, param: 'insuranceType', value: 'true' },
    ],
  },
  {
    name: 'cross-sell 交叉销售页（cross_sell_agg；BACKLOG 0f01e6 复发哨兵）',
    url: '/#/specialty?tab=cross-sell',
    // 无 fuel_type / vehicle_model 列：完整燃料 toggle 与车型 chip 隐藏
    hiddenChips: ['油/气/电', 'X自卸', 'X牵引', 'X普货'],
    // 交/商由 premium 口径等价支持（PR #569）；吨位列存在；燃料退化为 电/全部
    visibleChips: ['交/商', '1T货', '电/全部'],
    interactions: [
      // 0f01e6 根因：agg 表无 insurance_type 列 → 点交/商整页 400；修复后应正常发参且 200
      { chip: '交/商', api: /\/api\/query\/cross-sell/, param: 'insuranceType', value: 'true' },
    ],
  },
  {
    name: 'renewal-tracker 续保页（renewal_tracker；BACKLOG f5b2a3/f24766 复发哨兵）',
    url: '/#/renewal-tracker',
    // 无险类维度（盘内全商业险）+ 无吨位/车型列 + 燃料派生列无气
    hiddenChips: ['交/商', '油/气/电', '1T货', '2-9T货', '1-2T货', 'X自卸', 'X牵引', 'X普货'],
    visibleChips: ['家自车', '企客', '油/电'],
    interactions: [
      // f5b2a3 根因：useNonTimeFilterParams 漏读 vehicle_quick_filter → 家自车点了数据不动
      {
        chip: '家自车',
        api: /\/api\/query\/renewal-tracker/,
        param: 'customerCategories',
        value: '非营业个人客车',
      },
    ],
  },
  {
    name: 'claims-detail 赔案分析页（claims_detail 半连接；BACKLOG d0cd4b 复发哨兵）',
    url: '/#/claims-detail',
    hiddenChips: [],
    visibleChips: ['交/商', '油/气/电'],
    interactions: [
      // d0cd4b 根因：后端 parseFilters 静默丢弃 insuranceType（PR #571 已补解析）
      { chip: '交/商', api: /\/api\/query\/claims-detail/, param: 'insuranceType', value: 'true' },
    ],
  },
];

async function gotoPage(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');
  // QuickFilterBar 就绪信号：家自车 chip 在所有目标页都可见
  await expect(page.getByRole('button', { name: '家自车', exact: true })).toBeVisible({
    timeout: 15000,
  });
}

for (const spec of PAGES) {
  test(`筛选联动 — ${spec.name}`, async ({ page }) => {
    // ⚠️ 必须显式 test.skip 而非静默 return：静默 return 被记为 passed，
    // 冷启动数据未就绪时会得到假阳性「全部通过」（断言从未执行）——
    // 哨兵的可信度取决于 skipped 与 passed 在输出中可区分（负向验证踩过此坑）
    const hasData = await skipWhenNoData(page);
    test.skip(!hasData, '后端无数据（CI 或冷启动未就绪）——哨兵断言需本地数据环境');

    await gotoPage(page, spec.url);

    // 1) chip 集合与能力矩阵一致
    for (const chip of spec.hiddenChips) {
      await expect(
        page.getByRole('button', { name: chip, exact: true }),
        `「${chip}」应按能力矩阵隐藏`
      ).toHaveCount(0);
    }
    for (const chip of spec.visibleChips) {
      await expect(
        page.getByRole('button', { name: chip, exact: true }),
        `「${chip}」应可见`
      ).toBeVisible();
    }

    // 2) 点 chip → 请求 query 含对应参数（URL 解码后匹配中文值）
    for (const it of spec.interactions) {
      const requestPromise = page.waitForRequest(
        (req) =>
          it.api.test(req.url()) &&
          decodeURIComponent(req.url()).includes(`${it.param}=${it.value}`),
        { timeout: 20000 }
      );
      await page.getByRole('button', { name: it.chip, exact: true }).click();
      const request = await requestPromise;

      // 顺带断言响应非 5xx/4xx（0f01e6 修复前是整页 400）
      const response = await request.response();
      expect(response?.status(), `${it.param}=${it.value} 请求应成功`).toBeLessThan(400);
    }
  });
}
