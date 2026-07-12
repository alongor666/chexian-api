import { describe, expect, it } from 'vitest';
import { formatDocumentTitle, PRODUCT_METADATA } from '../productMetadata';

describe('product metadata', () => {
  it('exposes the approved user-facing names', () => {
    expect(PRODUCT_METADATA).toEqual({
      productName: '车险经营分析平台',
      mobileName: '车险经营',
      aiAssistantName: '经营副驾',
    });
  });

  it('formats a page title with the product name', () => {
    expect(formatDocumentTitle('成本分析')).toBe('成本分析｜车险经营分析平台');
  });
});
