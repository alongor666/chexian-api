/**
 * 文件模块纯逻辑（从 DataImportModal / ReportTemplatesModal 提取）
 *
 * - validateImportFile：导入文件校验（扩展名 + 大小上限）→ 错误串或 null
 * - mapImportError：上传失败原始消息 → 用户友好提示
 * - filterFileReportTemplates：报表模板按分类 + 关键词筛选
 *
 * 行为与原组件内联实现逐字符一致。
 */

/**
 * 导入文件大小上限：200MB（客户端预校验，网络请求前拦超限文件）。
 * 前端独立 bundle 无法读取 Node env，此为 server/src/config/env.ts
 * dbEnv.MAX_UPLOAD_SIZE_MB（默认 200MB）的镜像常量——两值必须一致，
 * 由 governance「上传上限对齐」闸逐字节校验防漂移。
 * 上限不匹配的后果：前端比后端紧 → 合规文件被浏览器提前拦下报错误信息。
 */
export const MAX_IMPORT_SIZE = 200 * 1024 * 1024;

/** 校验导入文件：非 .parquet 或超限返回错误串，合法返回 null */
export function validateImportFile(file: { name: string; size: number }): string | null {
  if (!file.name.endsWith('.parquet')) {
    return '请选择 .parquet 格式的文件';
  }
  if (file.size > MAX_IMPORT_SIZE) {
    // 文案由常量派生，避免上限调整时数字与常量脱节
    return `文件大小超过限制（最大${MAX_IMPORT_SIZE / 1024 / 1024}MB）`;
  }
  return null;
}

/** 上传失败原始消息 → 友好提示；无匹配规则时原样返回 */
export function mapImportError(rawMessage: string): string {
  if (rawMessage.includes('Snappy decompression failure')) {
    return '文件格式错误：Snappy 解压失败，请检查文件是否损坏或使用了不支持的压缩格式';
  }
  if (rawMessage.includes('Failed to read file')) {
    return '文件读取失败，请检查文件是否损坏';
  }
  return rawMessage;
}

/** 报表模板筛选：分类（「全部」放行）+ 关键词（不区分大小写，匹配名称或描述） */
export function filterFileReportTemplates<
  T extends { category: string; name: string; description: string }
>(templates: T[], category: string, searchQuery: string): T[] {
  return templates.filter((template) => {
    const matchesCategory = category === '全部' || template.category === category;
    const matchesSearch =
      template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });
}
