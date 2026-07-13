/**
 * 识别已退役 legacy 文档归档。路径、扩展名和正文标记三项必须同时满足，
 * 防止普通 reference 或代码文件绕过 PR 体量门禁。
 */
export function isArchivedLegacyChange(file, content) {
  const allowed = new Set(['reference/legacy-python-subproject-convention.md']);
  const header = typeof content === 'string' ? content.split('\n').slice(0, 5).join('\n') : '';
  return allowed.has(file)
    && typeof content === 'string'
    && header.includes('> **已退役，仅供历史追溯。**');
}
