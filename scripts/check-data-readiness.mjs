#!/usr/bin/env node

/**
 * 数据就绪校验（data-readiness）
 *
 * 职责：在「数据发布流程」里校验数据状态质量——在 ETL 完成后、发布到 VPS 前执行。
 * 与代码门禁（bun run governance）分离：这些检查随「数据更新」而变红，与代码无关，
 * 因此不应在 PR/push 的代码门禁里跑（CI 无 Parquet 数据时它们本就 skip，只会绊本地开发者）。
 *
 * 两阶段检查（按是否依赖 sync-vps 划分）：
 *   --phase=pre   ETL 后、sync-vps 前：Parquet 重叠 / Claims 去重 / 知识库规模
 *   --phase=post  sync-vps 后：本地 vs VPS 清单漂移
 *   --phase=all   全集，默认（手动跑时保持原行为）
 *
 * 调用：
 *   node scripts/check-data-readiness.mjs                  # 全集（手动验证）
 *   node scripts/check-data-readiness.mjs --phase=pre      # release 链路 sync-vps 前
 *   node scripts/check-data-readiness.mjs --phase=post     # release 链路 sync-vps 后
 *
 * 退出码：0 全部通过 / 1 存在失败
 */

import { pathToFileURL } from 'url';
import {
  DATA_READINESS_CHECKS,
  PRE_SYNC_READINESS_CHECKS,
  POST_SYNC_READINESS_CHECKS,
  runCheckList,
} from './check-governance.mjs';

function parsePhase(argv) {
  for (const arg of argv) {
    if (arg === '--phase=pre') return 'pre';
    if (arg === '--phase=post') return 'post';
    if (arg === '--phase=all') return 'all';
  }
  return 'all';
}

function main() {
  const phase = parsePhase(process.argv.slice(2));
  const { checks, title } = {
    pre: { checks: PRE_SYNC_READINESS_CHECKS, title: '数据就绪校验（pre-sync：内在质量）' },
    post: { checks: POST_SYNC_READINESS_CHECKS, title: '数据就绪校验（post-sync：同步漂移）' },
    all: { checks: DATA_READINESS_CHECKS, title: '数据就绪校验（data-readiness）' },
  }[phase];

  const ok = runCheckList(checks, title);
  if (!ok) {
    console.error(`\n\x1b[31m\x1b[1m[✗]\x1b[0m ${title} 失败，发布前请修复上述数据问题`);
    process.exit(1);
  }
  console.log(`\x1b[32m\x1b[1m[✓]\x1b[0m ${title} 全部通过！`);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
