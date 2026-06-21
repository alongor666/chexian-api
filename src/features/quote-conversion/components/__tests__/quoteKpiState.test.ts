/**
 * isQuoteKpiEmpty 单测 — 多省接入空态保护判据（ADR G8 / Day-1 SOP §5 推广至报价转化子页）
 *
 * 背景：报价转化 KPI 端点 `data: data[0] ?? {}`（server query/quote-conversion.ts），
 * 新分公司数据装载中 / 缺数据时返回空对象 {} 或全零聚合行。组件原 `!data` 守卫无法识别
 * 空对象（{} 为 truthy），会静默渲染 0.0% 转化率 / 0 件报价，误导业务方为「真实零报价」。
 *
 * 锁定：undefined / 空对象 / 全零规模视为空；任一规模指标 > 0 视为有数据。
 */
import { describe, it, expect } from 'vitest';
import { isQuoteKpiEmpty } from '../quoteKpiState';
import type { QuoteKpi } from '../../types';

describe('isQuoteKpiEmpty', () => {
  it('undefined（接口未返回 / 装载中）视为空', () => {
    expect(isQuoteKpiEmpty(undefined)).toBe(true);
  });

  it('空对象（后端 data[0] ?? {} 兜底）视为空', () => {
    expect(isQuoteKpiEmpty({} as QuoteKpi)).toBe(true);
  });

  it('三项规模指标全零（聚合无行 / 该范围真实无报价）视为空', () => {
    expect(
      isQuoteKpiEmpty({ total_quotes: 0, total_insured: 0, insured_premium: 0 } as QuoteKpi)
    ).toBe(true);
  });

  it('报价总量 > 0 视为有数据', () => {
    expect(isQuoteKpiEmpty({ total_quotes: 120 } as QuoteKpi)).toBe(false);
  });

  it('承保件数 > 0 视为有数据', () => {
    expect(isQuoteKpiEmpty({ total_insured: 80 } as QuoteKpi)).toBe(false);
  });

  it('承保保费 > 0 视为有数据（即便件数缺失）', () => {
    expect(isQuoteKpiEmpty({ insured_premium: 350000 } as QuoteKpi)).toBe(false);
  });

  it('仅占比指标有值但规模全空，仍视为空（避免静默展示零转化率）', () => {
    expect(
      isQuoteKpiEmpty({ underwriting_rate: 62.5, avg_discount_rate: 0.85 } as QuoteKpi)
    ).toBe(true);
  });
});
