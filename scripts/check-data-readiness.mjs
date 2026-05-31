#!/usr/bin/env node

/**
 * 数据就绪校验（data-readiness）
 *
 * 职责：在「数据发布流程」里校验数据状态质量——在 ETL 完成后、发布到 VPS 前执行。
 * 与代码门禁（bun run governance）分离：这些检查随「数据更新」而变红，与代码无关，
 * 因此不应在 PR/push 的代码门禁里跑（CI 无 Parquet 数据时它们本就 skip，只会绊本地开发者）。
 *
 * 检查项（从 check-governance.mjs 解耦而来）：
 *   - Parquet 时间重叠（policy/current）
 *   - Claims 去重（claims_detail）
 *   - 知识库数据规模一致性（QUICK_REFERENCE.md vs 实际分片）
 *   - 本地 vs VPS 同步漂移
 *
 * 调用：
 *   node scripts/check-data-readiness.mjs           # 直接跑
 *   被 scripts/sync-and-reload.mjs 的 Stage 1.7 调用（release:daily 链路）
 *
 * 退出码：0 全部通过 / 1 存在失败
 */

import { pathToFileURL } from 'url';
import { DATA_READINESS_CHECKS, runCheckList } from './check-governance.mjs';

function main() {
  const ok = runCheckList(DATA_READINESS_CHECKS, '数据就绪校验（data-readiness）');
  if (!ok) {
    console.error('\n\x1b[31m\x1b[1m[✗]\x1b[0m 数据就绪校验失败，发布前请修复上述数据问题');
    process.exit(1);
  }
  console.log('\x1b[32m\x1b[1m[✓]\x1b[0m 数据就绪校验全部通过！');
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
