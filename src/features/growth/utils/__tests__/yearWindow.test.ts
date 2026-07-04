/**
 * yearWindow 纯函数单测（BACKLOG 2026-06-11-claude-2e311d）
 *
 * 覆盖两个修复点：
 * 1. deriveGrowthYearWindow：analysis_year 派生年份窗口（往年 vs 当前年 YTD）
 * 2. shiftDateBackOneYear：闰年 2/29 安全回退上年 2/28（原手写字符串拼接会
 *    产出不存在的 `${year}-02-29` 非法日期）
 */
import { describe, it, expect } from 'vitest';
import { deriveGrowthYearWindow, shiftDateBackOneYear } from '../yearWindow';

describe('deriveGrowthYearWindow', () => {
  const today = new Date('2026-07-04T00:00:00Z');

  it('analysisYear 缺省时回退到 today 所在年（保持修复前默认行为）', () => {
    const result = deriveGrowthYearWindow(undefined, today);
    expect(result.year).toBe(2026);
    expect(result.startDate).toBe('2026-01-01');
    expect(result.endDate).toBe('2026-07-04'); // YTD 到 today，而非 12-31
  });

  it('analysisYear 等于当前年 → YTD（区间末取 today，与修复前一致）', () => {
    const result = deriveGrowthYearWindow(2026, today);
    expect(result.startDate).toBe('2026-01-01');
    expect(result.endDate).toBe('2026-07-04');
  });

  it('analysisYear 为往年 → 全年窗口（区间末取该年 12-31，不再误查当前年）', () => {
    const result = deriveGrowthYearWindow(2024, today);
    expect(result.year).toBe(2024);
    expect(result.startDate).toBe('2024-01-01');
    expect(result.endDate).toBe('2024-12-31');
  });

  it('analysisYear 为更早往年同样取全年窗口', () => {
    const result = deriveGrowthYearWindow(2022, today);
    expect(result.startDate).toBe('2022-01-01');
    expect(result.endDate).toBe('2022-12-31');
  });
});

describe('shiftDateBackOneYear', () => {
  it('普通日期正常回退 1 年', () => {
    expect(shiftDateBackOneYear('2026-07-04')).toBe('2025-07-04');
    expect(shiftDateBackOneYear('2026-01-01')).toBe('2025-01-01');
  });

  it('闰年 2 月 29 日回退到上年 2 月 28 日（而非拼出非法日期）', () => {
    // 2024 是闰年；上一年 2023 不是闰年，2023-02-29 不存在
    expect(shiftDateBackOneYear('2024-02-29')).toBe('2023-02-28');
  });

  it('闰年 2 月 29 日回退：即便上一年恰好也是闰年，仍统一取 02-28（与后端 shiftDateBackOneYear 同口径）', () => {
    // 与 server/src/routes/query/growth.ts 的 shiftDateBackOneYear 保持一致行为，
    // 不做"上年若也是闰年则保留 02-29"的特判
    expect(shiftDateBackOneYear('2028-02-29')).toBe('2027-02-28');
  });

  it('非闰日的 2 月日期不受影响', () => {
    expect(shiftDateBackOneYear('2026-02-28')).toBe('2025-02-28');
  });

  it('跨年月末日期（月末不含 2/29）保持月/日不变', () => {
    expect(shiftDateBackOneYear('2026-12-31')).toBe('2025-12-31');
  });
});
