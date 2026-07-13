/**
 * 识别已退役 legacy 文档归档。路径、扩展名和正文标记三项必须同时满足，
 * 防止普通 reference 或代码文件绕过 PR 体量门禁。
 */
export function isArchivedLegacyChange(file, content) {
  return /^reference\/legacy-[^/]+\.md$/.test(file)
    && typeof content === 'string'
    && /(?:历史状态\s*[：:]\s*)?已退役/.test(content);
}
