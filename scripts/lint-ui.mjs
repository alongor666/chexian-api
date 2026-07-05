#!/usr/bin/env node

/**
 * UI 风格检查独立入口（2026-07-04 governance 奥卡姆批次一）
 *
 * DarkMode 质量门禁 + ECharts splitLine 合规原是 `bun run governance` 主链中的两项，
 * 属 UI 风格 lint 而非"治理一致性"——移到本独立入口后能力完整保留，
 * 不再占用每次 push / CI 的治理关键路径。
 *
 * 用法：bun run lint:ui
 * 退出码：0 = 全部通过；1 = 存在违规
 */
import { runCheckList, checkDarkModeQuality, checkEchartsSplitLine } from './check-governance.mjs';

const ok = runCheckList(
  [
    { name: 'DarkMode质量', fn: checkDarkModeQuality },
    { name: 'ECharts网格线', fn: checkEchartsSplitLine },
  ],
  'UI 风格检查',
);
process.exit(ok ? 0 : 1);
