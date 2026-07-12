export const PRODUCT_METADATA = Object.freeze({
  productName: '车险经营分析平台',
  mobileName: '车险经营',
  aiAssistantName: '经营副驾',
});

export function formatDocumentTitle(pageName?: string): string {
  return pageName ? `${pageName}｜${PRODUCT_METADATA.productName}` : PRODUCT_METADATA.productName;
}
