import { describe, it, expect } from 'vitest';
import {
  validateImportFile,
  mapImportError,
  filterFileReportTemplates,
  MAX_IMPORT_SIZE,
} from './fileHelpers';

describe('validateImportFile · 导入文件校验', () => {
  it('非 .parquet 扩展名 → 格式错误', () => {
    expect(validateImportFile({ name: 'data.csv', size: 1 })).toBe('请选择 .parquet 格式的文件');
    expect(validateImportFile({ name: 'parquet', size: 1 })).toBe('请选择 .parquet 格式的文件'); // 无点
  });

  it('.parquet 但超过 100MB → 超限错误', () => {
    expect(validateImportFile({ name: 'big.parquet', size: MAX_IMPORT_SIZE + 1 })).toBe(
      '文件大小超过限制（最大100MB）'
    );
  });

  it('合法 .parquet 且未超限 → null（边界：恰好 100MB 放行）', () => {
    expect(validateImportFile({ name: 'ok.parquet', size: 1024 })).toBeNull();
    expect(validateImportFile({ name: 'edge.parquet', size: MAX_IMPORT_SIZE })).toBeNull();
  });

  it('扩展名优先于大小：非 .parquet 且超限 → 仍报格式错误', () => {
    expect(validateImportFile({ name: 'data.csv', size: MAX_IMPORT_SIZE + 1 })).toBe(
      '请选择 .parquet 格式的文件'
    );
  });
});

describe('mapImportError · 友好错误映射', () => {
  it('Snappy 解压失败 → 友好格式错误', () => {
    expect(mapImportError('IO Error: Snappy decompression failure at 0x12')).toBe(
      '文件格式错误：Snappy 解压失败，请检查文件是否损坏或使用了不支持的压缩格式'
    );
  });

  it('Failed to read file → 友好读取错误', () => {
    expect(mapImportError('Failed to read file /tmp/x')).toBe('文件读取失败，请检查文件是否损坏');
  });

  it('Snappy 优先于 Failed to read（两者同现 → Snappy 文案）', () => {
    expect(mapImportError('Snappy decompression failure; Failed to read file')).toBe(
      '文件格式错误：Snappy 解压失败，请检查文件是否损坏或使用了不支持的压缩格式'
    );
  });

  it('无匹配规则 → 原样返回', () => {
    expect(mapImportError('某个未知错误')).toBe('某个未知错误');
  });
});

describe('filterFileReportTemplates · 分类 + 关键词筛选', () => {
  const templates = [
    { category: '日报', name: 'Daily Summary', description: '每日经营汇总' },
    { category: '周报', name: 'Weekly Review', description: '周度 Snappy 复盘' },
    { category: '日报', name: '续保日报', description: '每日续保跟踪' },
  ];

  it('「全部」+ 空关键词 → 全集', () => {
    expect(filterFileReportTemplates(templates, '全部', '')).toHaveLength(3);
  });

  it('按分类筛选', () => {
    expect(filterFileReportTemplates(templates, '日报', '')).toHaveLength(2);
    expect(filterFileReportTemplates(templates, '周报', '')).toHaveLength(1);
  });

  it('关键词匹配名称（不区分大小写）', () => {
    const r = filterFileReportTemplates(templates, '全部', 'WEEKLY');
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('Weekly Review');
  });

  it('关键词匹配描述（中文）', () => {
    expect(filterFileReportTemplates(templates, '全部', '续保')).toHaveLength(1);
  });

  it('描述大小写不敏感：SNAPPY 匹配「周度 Snappy 复盘」', () => {
    const r = filterFileReportTemplates(templates, '全部', 'SNAPPY');
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('Weekly Review');
  });

  it('分类 + 关键词组合', () => {
    expect(filterFileReportTemplates(templates, '日报', '续保')).toHaveLength(1);
    expect(filterFileReportTemplates(templates, '周报', '续保')).toHaveLength(0);
  });

  it('无匹配 → 空数组', () => {
    expect(filterFileReportTemplates(templates, '全部', '不存在的词')).toEqual([]);
  });
});
