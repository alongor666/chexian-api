/**
 * parquet-metadata 纯函数单元测试 — CI 可跑（无原生模块依赖）
 *
 * 背景（PR #585）：ETL 5c5caffe 把元数据键名 processing_mode 改为 etl_processing_mode，
 * 服务端守卫只认旧键导致 merged 拒载守卫静默失效两个月。键匹配逻辑此前仅有
 * CI 够不着的本地集成测试覆盖，本文件让 CI 对该契约有感知。
 */
import { describe, expect, it } from 'vitest';
import { normalizeMetadataValue, resolveProcessingMode } from '../parquet-metadata.js';

describe('resolveProcessingMode', () => {
  it('识别 ETL 统一写出的新键 etl_processing_mode', () => {
    expect(resolveProcessingMode([{ key: 'etl_processing_mode', value: 'full' }])).toBe('full');
    expect(resolveProcessingMode([{ key: 'etl_processing_mode', value: 'merged' }])).toBe('merged');
  });

  it('兼容更名前存量文件的旧键 processing_mode', () => {
    expect(resolveProcessingMode([{ key: 'processing_mode', value: 'merged' }])).toBe('merged');
  });

  it('双键并存时新键优先', () => {
    const rows = [
      { key: 'processing_mode', value: 'full' },
      { key: 'etl_processing_mode', value: 'merged' },
    ];
    expect(resolveProcessingMode(rows)).toBe('merged');
  });

  it('无相关键返回 null（守卫走兼容模式）', () => {
    expect(resolveProcessingMode([])).toBeNull();
    expect(resolveProcessingMode([{ key: 'source_file', value: 'a.xlsx' }])).toBeNull();
  });

  it('键与值大小写归一化为小写', () => {
    expect(resolveProcessingMode([{ key: 'ETL_Processing_Mode', value: 'FULL' }])).toBe('full');
  });

  it('解析 DuckDB Buffer 包装形态的 key/value', () => {
    const wrap = (s: string) => ({ bytes: Buffer.from(s, 'utf-8') });
    expect(resolveProcessingMode([{ key: wrap('etl_processing_mode'), value: wrap('merged') }])).toBe('merged');
  });

  it('解析 bytes.data 数组形态', () => {
    const wrap = (s: string) => ({ bytes: { data: Array.from(Buffer.from(s, 'utf-8')) } });
    expect(resolveProcessingMode([{ key: wrap('processing_mode'), value: wrap('full') }])).toBe('full');
  });
});

describe('normalizeMetadataValue', () => {
  it('null/undefined/空串返回 null', () => {
    expect(normalizeMetadataValue(null)).toBeNull();
    expect(normalizeMetadataValue(undefined)).toBeNull();
    expect(normalizeMetadataValue('   ')).toBeNull();
  });

  it('普通字符串去首尾空白', () => {
    expect(normalizeMetadataValue('  full ')).toBe('full');
  });

  it('键值对象（索引→字节）形态归一化', () => {
    const bytes = Object.fromEntries(Array.from(Buffer.from('full', 'utf-8')).map((b, i) => [String(i), b]));
    expect(normalizeMetadataValue({ bytes })).toBe('full');
  });
});
