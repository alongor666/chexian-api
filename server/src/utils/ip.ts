/**
 * IP 白名单校验工具（唯一事实源）
 *
 * 从 services/auth.ts 的私有方法抽出为纯函数，供两个消费点共用：
 * 1. 账密登录（services/auth.ts login）——历史行为不变；
 * 2. PAT 校验（services/personal-access-token.ts verifyPat）——补齐"PAT 泄漏后
 *    可从任意 IP 调用"的缺口：allowedIps 只在登录门口生效、进屋后不再管的旧语义
 *    对长期有效的 PAT 不成立，必须每次验证都比对。
 *
 * 语义（与登录路径逐字节一致，勿单侧修改）：
 * - allowedIps 未配置或为空数组 → 放行（未启用白名单的账号不受影响）；
 * - 配置了白名单但拿不到 clientIp → 拒绝（fail-closed）；
 * - 比对前双侧归一化：取 X-Forwarded-For 逗号链首个、剥 IPv6 映射前缀
 *   `::ffff:`、`::1` 视同 `127.0.0.1`。
 */

export function normalizeIpValue(ip: string): string {
  let normalized = ip.trim();
  if (normalized.includes(',')) {
    normalized = normalized.split(',')[0].trim();
  }
  if (normalized.startsWith('::ffff:')) {
    normalized = normalized.slice(7);
  }
  if (normalized === '::1') {
    normalized = '127.0.0.1';
  }
  return normalized;
}

export function isIpAllowed(
  clientIp: string | undefined,
  allowedIps: string[] | undefined
): boolean {
  if (!allowedIps || allowedIps.length === 0) return true;
  if (!clientIp) return false;
  const normalizedClient = normalizeIpValue(clientIp);
  return allowedIps.some(ip => normalizeIpValue(ip) === normalizedClient);
}
