/**
 * ecosystem.config.cjs 解析器（纯函数，可测试）
 *
 * 从 ecosystem 配置文本中提取 env 块的键名和 CORS_ORIGIN 值。
 */

/**
 * 从 ecosystem.config.cjs 纯文本中提取第一个 env: { ... } 块的键名
 *
 * @param {string} content - ecosystem.config.cjs 文件内容
 * @returns {{ keys: string[], corsOrigin: string, env: Record<string, string> }}
 *   - keys: env 块内所有键名（保持既有语义）
 *   - corsOrigin: CORS_ORIGIN 的清洗后值（保持既有语义）
 *   - env: 键 → 清洗后值（去行内注释 / 去引号）的完整映射，供治理/发布脚本共用同一解析，
 *          避免各处再写易误伤注释/重复块的单行正则
 */
export function parseEcosystemEnvKeys(content) {
  // 1. 剥离块注释 /* ... */
  const cleaned = content.replace(/\/\*[\s\S]*?\*\//g, '');

  // 2. 用负向后瞻精确匹配 env:（排除 env_production: 等）
  const envMatch = cleaned.match(/(?<![_\w])env\s*:/);
  if (!envMatch) return { keys: [], corsOrigin: '', env: {} };

  const envStart = envMatch.index;

  // 3. 找到 { 开始
  const braceStart = cleaned.indexOf('{', envStart);
  if (braceStart === -1) return { keys: [], corsOrigin: '', env: {} };

  // 4. 匹配对应的 }（状态机计数大括号深度）
  let depth = 0;
  let braceEnd = -1;
  for (let i = braceStart; i < cleaned.length; i++) {
    if (cleaned[i] === '{') depth++;
    if (cleaned[i] === '}') {
      depth--;
      if (depth === 0) {
        braceEnd = i;
        break;
      }
    }
  }
  if (braceEnd === -1) return { keys: [], corsOrigin: '', env: {} };

  const block = cleaned.slice(braceStart + 1, braceEnd);
  const keys = [];
  const env = {};
  let corsOrigin = '';

  // 清洗单个原始值：优先取引号内内容（避免 https:// 被行内注释正则误伤），否则剥行内注释
  const cleanValue = (raw) => {
    const quotedMatch = raw.match(/['"]([^'"]*)['"]/);
    return quotedMatch ? quotedMatch[1].trim() : raw.replace(/\/\/.*$/, '').trim();
  };

  // 5. 提取 KEY: value 对，剥离行内注释
  const keyPattern = /^\s*(\w+)\s*:\s*(.+?)(?:,\s*)?$/gm;
  let match;
  while ((match = keyPattern.exec(block)) !== null) {
    keys.push(match[1]);
    const value = cleanValue(match[2]);
    env[match[1]] = value;
    if (match[1] === 'CORS_ORIGIN') {
      corsOrigin = value;
    }
  }

  return { keys, corsOrigin, env };
}
