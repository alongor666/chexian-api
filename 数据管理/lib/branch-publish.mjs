/**
 * 多省 ETL「分省编排」纯函数 — release:daily 遍历注册省份，每个非 SC 省各跑一遍
 *
 * 背景：release:daily（sync-and-reload.mjs）原只跑 SC 默认链路，山西 SX 从未在发布流程
 * 自动跑过 → 山西数据停滞（用户："山西赔案停 06-23，从没单独跑过 SX"）。本模块把
 * 「遍历注册省份 → 为每个非 SC 省逐域生成 daily.mjs 子进程命令」抽成无副作用纯函数。
 *
 * ⚠️ 省份枚举单一来源 = source-file-routing.mjs registeredBranchCodesFromPrefixMap()
 * （拼音 map values；与 fields.json branch_code.derivation.mapping 由 governance「省份前缀
 * 映射一致」静态对比闸保证同步）。**不在此重复读 fields.json**——避免引入第三个 SSOT
 * 调用点（闸-1 B2 P0-B）。
 *
 * 为什么逐域而非 `BRANCH_CODE=SX daily.mjs all`：daily.mjs 非 SC premium 跑完即 return
 * （刻意跳过 all 模式追加域，见 daily.mjs main 注释），故分省必须逐域调用。
 *
 * 无副作用、不读文件系统 / 子进程，可被 vitest 直接 import。
 */
import { registeredBranchCodesFromPrefixMap } from './source-file-routing.mjs';

// 非 SC 省日常发布的核心全量域，对应上游 BI 编号 01签单(premium)/05理赔(claims_detail)/03维修(repair)。
// 这是「域」列表（固定 ETL 域）非省份硬编码；可扩展（如 quotes，待该省报价源到位后加入）。
// daily.mjs 在 BRANCH_PUBLISH=1 下对无源域 graceful skip（warn 不中断），故列表含某省暂无的
// 域也安全（自动跳过，不阻断其他域）。
export const BRANCH_PUBLISH_DOMAINS = Object.freeze(['premium', 'claims_detail', 'repair']);

/** 非 SC 注册省份（从拼音 map 单一来源派生，过滤掉 SC；SC 走 sync-and-reload 原默认链路）。 */
export function nonScBranchCodes() {
  return registeredBranchCodesFromPrefixMap().filter((c) => c !== 'SC');
}

/**
 * 为每个非 SC 省 × coreDomains 生成 daily.mjs 子进程步骤（含 BRANCH_CODE + BRANCH_PUBLISH env）。
 * SC **不在此列**（走 sync-and-reload 原 buildEtlCommands 默认链路，逐字节不变，字节安全）。
 * @param {string[]} [branchCodes=nonScBranchCodes()] 非 SC 省列表（默认数据驱动）
 * @param {readonly string[]} [coreDomains=BRANCH_PUBLISH_DOMAINS]
 * @returns {Array<{label:string,args:string[],env:Record<string,string>}>}
 */
export function buildBranchEtlSteps(branchCodes = nonScBranchCodes(), coreDomains = BRANCH_PUBLISH_DOMAINS) {
  const steps = [];
  for (const branch of branchCodes) {
    for (const domain of coreDomains) {
      steps.push({
        label: `ETL:${branch}:${domain}`,
        args: ['数据管理/daily.mjs', domain, '--no-sync', '--skip-report'],
        env: { BRANCH_CODE: branch, BRANCH_PUBLISH: '1' },
      });
    }
  }
  return steps;
}
