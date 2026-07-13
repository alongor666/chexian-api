import { describe, expect, it } from 'vitest';
import { isArchivedLegacyChange } from '../governance/pr-size-archive-classification.mjs';

describe('PR 体量退役 legacy reference 分类', () => {
  it('仅忽略带明确退役标记的 reference/legacy-*.md', () => {
    expect(isArchivedLegacyChange(
      'reference/legacy-python-convention.md',
      '# Legacy\n\n> 历史状态：已退役。仅供追溯。',
    )).toBe(true);
    expect(isArchivedLegacyChange(
      'reference/legacy-python-convention.md',
      '# Legacy\n\n> **已退役，仅供历史追溯。**',
    )).toBe(true);
  });

  it('不忽略普通 reference、不带退役标记或非 Markdown 文件', () => {
    expect(isArchivedLegacyChange('reference/current.md', '历史状态：已退役')).toBe(false);
    expect(isArchivedLegacyChange('reference/legacy-current.md', '# 仍在使用')).toBe(false);
    expect(isArchivedLegacyChange('reference/legacy-code.ts', '// 历史状态：已退役')).toBe(false);
    expect(isArchivedLegacyChange('docs/legacy-current.md', '历史状态：已退役')).toBe(false);
  });
});
