export function formatNum(n: number): string {
  return n.toLocaleString('zh-CN');
}

export function formatPct(numerator: number, denominator: number): string {
  if (denominator === 0) return '—';
  return (numerator / denominator * 100).toFixed(1) + '%';
}
