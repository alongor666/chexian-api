/**
 * cx CLI `--category` 帮助文本 ↔ 指标注册表分类 机器对账
 *
 * 背景：cli/ 是同步到独立仓库 alongor666/cx-cli 的 SSOT 子包，不能反向 import
 * server 代码，因此 `cx metrics --category` 帮助文本里的分类枚举是一份受控复制品。
 * 注册表新增/删除分类而 CLI 帮助未同步时，本测试红（2026-07 审计发现该枚举无任何守护）。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getAllMetrics } from '../index.js';

const CLI_INDEX_PATH = fileURLToPath(new URL('../../../../../cli/src/index.ts', import.meta.url));

describe('cx CLI --category 帮助文本与注册表分类一致', () => {
  it('帮助文本枚举 = 注册表实际使用的分类集合', () => {
    const src = fs.readFileSync(CLI_INDEX_PATH, 'utf-8');
    const m = src.match(/指标分类（([a-z_|]+)）/);
    expect(m, 'cli/src/index.ts 中未找到 "指标分类（a|b|...）" 帮助文本').not.toBeNull();

    const helpCategories = [...new Set(m![1].split('|'))].sort();
    const registryCategories = [...new Set(getAllMetrics().map((metric) => metric.category))].sort();

    expect(helpCategories).toEqual(registryCategories);
  });
});
