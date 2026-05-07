/**
 * Accept-Encoding 协商工具
 *
 * 解析 RFC 7231 §5.3.4 风格的 Accept-Encoding 头，正确处理 q-value：
 * - "br" 或 "gzip, br" → 接受
 * - "br;q=0" 或 "gzip, br;q=0" → 拒绝（客户端明确禁用 br）
 * - "*;q=0, gzip;q=1" → gzip 接受、br 拒绝
 *
 * 简单的 /\bbr\b/ 正则会把 "br;q=0" 当作支持，导致严格客户端/代理解码失败。
 */

/** 返回客户端对指定编码的可接受 q-value（0 表示不接受，>0 表示可用）。 */
function getEncodingQuality(header: string, encoding: string): number {
  if (!header) return 0;
  const target = encoding.toLowerCase();
  let identityQ = 1;
  let starQ: number | null = null;
  let directQ: number | null = null;

  for (const raw of header.toLowerCase().split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const [token, ...params] = part.split(';').map((s) => s.trim());
    let q = 1;
    for (const p of params) {
      if (p.startsWith('q=')) {
        const parsed = parseFloat(p.slice(2));
        if (!Number.isNaN(parsed)) q = parsed;
      }
    }
    if (token === target) directQ = q;
    else if (token === '*') starQ = q;
    else if (token === 'identity') identityQ = q;
  }

  if (directQ !== null) return directQ;
  if (starQ !== null) return starQ;
  // 未匹配 + 未匹配 *：identity 隐式可用，其他编码默认 q=0（除 identity 外）
  return target === 'identity' ? identityQ : 0;
}

export function clientAcceptsBrotli(acceptEncoding: string | undefined | null): boolean {
  return getEncodingQuality(String(acceptEncoding ?? ''), 'br') > 0;
}

export function clientAcceptsGzip(acceptEncoding: string | undefined | null): boolean {
  return getEncodingQuality(String(acceptEncoding ?? ''), 'gzip') > 0;
}
