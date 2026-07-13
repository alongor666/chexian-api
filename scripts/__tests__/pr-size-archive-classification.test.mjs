import { describe, expect, it } from 'vitest';
import { isArchivedLegacyChange } from '../governance/pr-size-archive-classification.mjs';

describe('PR 体量退役 legacy reference 分类', () => {
  it('仅忽略 allowlist 文件且前五行含精确退役标记', () => {
    expect(isArchivedLegacyChange(
      'reference/legacy-python-subproject-convention.md',
      '# Legacy\n\n> **已退役，仅供历史追溯。**',
    )).toBe(true);
  });

  it('不忽略非 allowlist、无头部标记、末尾标记或非 Markdown 文件', () => {
    expect(isArchivedLegacyChange('reference/current.md', '历史状态：已退役')).toBe(false);
    expect(isArchivedLegacyChange('reference/legacy-current.md', '> **已退役，仅供历史追溯。**')).toBe(false);
    expect(isArchivedLegacyChange('reference/legacy-python-subproject-convention.md', '# 仍在使用')).toBe(false);
    expect(isArchivedLegacyChange(
      'reference/legacy-python-subproject-convention.md',
      '# Legacy\n1\n2\n3\n4\n5\n> **已退役，仅供历史追溯。**',
    )).toBe(false);
    expect(isArchivedLegacyChange('reference/legacy-code.ts', '// 历史状态：已退役')).toBe(false);
    expect(isArchivedLegacyChange('docs/legacy-current.md', '历史状态：已退役')).toBe(false);
  });
});
