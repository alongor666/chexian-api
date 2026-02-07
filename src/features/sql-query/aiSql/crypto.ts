import { Logger } from '@/shared/utils/logger';

const logger = new Logger('Crypto');

/**
 * 简单加密工具
 *
 * 使用 XOR + Base64 对敏感数据进行混淆存储
 * 注意：这不是强加密，仅用于防止明文存储
 * 生产环境建议使用环境变量预设，避免用户手动输入
 */

// 混淆密钥（使用固定密钥 + 用户指纹生成）
const OBFUSCATION_PREFIX = 'zhipu_v1_';

/**
 * 生成浏览器指纹作为混淆因子
 * 增加逆向难度，但不影响同一浏览器解密
 */
function getBrowserFingerprint(): string {
  const components = [
    navigator.userAgent.slice(0, 20),
    navigator.language,
    screen.colorDepth.toString(),
    new Date().getTimezoneOffset().toString(),
  ];
  return components.join('|');
}

/**
 * XOR 加密
 */
function xorCipher(text: string, key: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i) ^ key.charCodeAt(i % key.length);
    result += String.fromCharCode(charCode);
  }
  return result;
}

/**
 * 加密 API Key
 *
 * @param apiKey 原始 API Key
 * @returns 加密后的字符串（带前缀）
 */
export function encryptApiKey(apiKey: string): string {
  if (!apiKey) return '';

  try {
    const key = getBrowserFingerprint();
    const encrypted = xorCipher(apiKey, key);
    // Base64 编码，确保存储安全
    const base64 = btoa(encrypted);
    return OBFUSCATION_PREFIX + base64;
  } catch {
    // 降级：返回原文（不加前缀）
    logger.warn('[Crypto] Encryption failed, storing as plaintext');
    return apiKey;
  }
}

/**
 * 解密 API Key
 *
 * @param encrypted 加密后的字符串
 * @returns 原始 API Key
 */
export function decryptApiKey(encrypted: string): string {
  if (!encrypted) return '';

  // 检查是否是加密格式
  if (!encrypted.startsWith(OBFUSCATION_PREFIX)) {
    // 兼容旧的明文存储
    return encrypted;
  }

  try {
    const base64 = encrypted.slice(OBFUSCATION_PREFIX.length);
    const decoded = atob(base64);
    const key = getBrowserFingerprint();
    return xorCipher(decoded, key);
  } catch {
    // 解密失败，可能是浏览器指纹变化
    logger.warn('[Crypto] Decryption failed, returning empty');
    return '';
  }
}

/**
 * 检查是否是加密格式
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(OBFUSCATION_PREFIX);
}
