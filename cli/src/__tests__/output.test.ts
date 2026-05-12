import { describe, it, expect } from 'vitest';
import { renderOutput } from '../output.js';

describe('renderOutput', () => {
  const rows = [
    { name: 'alice', score: 90 },
    { name: 'bob', score: 85 },
  ];

  it('json: 直接序列化', () => {
    const out = renderOutput({ data: rows }, 'json');
    expect(JSON.parse(out)).toEqual({ data: rows });
  });

  it('csv: 头 + 数据，处理特殊字符', () => {
    const out = renderOutput([{ a: 'hi, "world"', b: 1 }], 'csv');
    expect(out.split('\n')[0]).toBe('a,b');
    expect(out.split('\n')[1]).toBe('"hi, ""world""",1');
  });

  it('table: 渲染为字符串（包含表头）', () => {
    const out = renderOutput(rows, 'table');
    expect(out).toMatch(/name/);
    expect(out).toMatch(/score/);
    expect(out).toMatch(/alice/);
  });

  it('从 .data.rows 自动挖出 rows', () => {
    const wrapped = { data: { rows } };
    const out = renderOutput(wrapped, 'csv');
    expect(out).toContain('alice');
  });

  it('空数组：返回 (no rows)', () => {
    expect(renderOutput([], 'table')).toMatch(/no rows/);
  });
});
