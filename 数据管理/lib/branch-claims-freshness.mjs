/**
 * 跨省 claims 报案截止日新鲜度巡检纯函数 — 省份→claims 目录派生 + 巡检结果分类
 *
 * 背景：claims 报案截止日落后会让满期赔付率系统性偏低（2026-06-08 对账事故）。现状
 * daily.mjs runClaimsDetail Step 5.5 只在跑 claims ETL 时查「当前省」；山西 SX 赔案停滞
 * 从未被主动跨省巡检发现。本模块把「省份→claims_detail 目录派生」与「巡检结果分类」抽成
 * 无副作用纯函数，配合 daily.mjs 的 `freshness` 跨省巡检命令，复用 claims-freshness.mjs 的
 * lag 判定（claimsReportLagDays + shouldWarnClaimsFreshness）。
 *
 * 无副作用、不读文件系统 / 子进程，可被 vitest 直接 import。
 */
import { join } from 'node:path';
import { branchOutputRoot } from './branch-naming.mjs';
import { claimsReportLagDays, shouldWarnClaimsFreshness } from './claims-freshness.mjs';

/**
 * 某省 claims_detail 分区目录。
 * SC/空 → warehouse/fact/claims_detail（主表，与 runClaimsDetail 的 CLAIMS_DETAIL_DIR 一致；
 *         **不走 branchOutputRoot**——后者对 SC 返回 policy/current 而非 claims）；
 * 非 SC → branchOutputRoot(warehouse,<省>) + claims_detail（= validation/<省>/claims_detail，隔离）。
 * @param {string} warehouseRoot  数据管理/warehouse 根
 * @param {string} branchCode     CHAR(2)
 * @returns {string}
 */
export function branchClaimsDetailDir(warehouseRoot, branchCode) {
  if (!branchCode || branchCode === 'SC') return join(warehouseRoot, 'fact', 'claims_detail');
  return join(branchOutputRoot(warehouseRoot, branchCode), 'claims_detail');
}

/**
 * 汇总跨省巡检结果：按 lag 分类 stale（落后告警）/ fresh（新鲜）/ unreadable（读不到日期）。
 * 复用 claims-freshness.mjs 的 lag 判定，保证与单省 Step 5.5 口径一致。
 * @param {Array<{branch:string,maxReportDate:string|null,today:string}>} probes  每省取数结果
 * @param {number} [threshold]  覆盖默认阈值（测试用；缺省走 shouldWarnClaimsFreshness 默认 3）
 * @returns {{stale:Array,fresh:Array,unreadable:Array}}
 */
export function summarizeFreshnessPatrol(probes, threshold) {
  const stale = [];
  const fresh = [];
  const unreadable = [];
  for (const p of probes) {
    const lagDays = claimsReportLagDays(p.maxReportDate, p.today);
    if (lagDays === null) {
      unreadable.push({ ...p, lagDays: null }); // 读不到日期（目录缺失 / 空分区 / 非法日期）
      continue;
    }
    const row = { ...p, lagDays };
    if (shouldWarnClaimsFreshness(lagDays, threshold)) stale.push(row);
    else fresh.push(row);
  }
  return { stale, fresh, unreadable };
}
