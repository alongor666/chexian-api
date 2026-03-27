/**
 * ecosystem.config.cjs 解析器（纯函数，可测试）
 *
 * 从 ecosystem 配置文本中提取 env 块的键名和 CORS_ORIGIN 值。
 */

/**
 * 从 ecosystem.config.cjs 纯文本中提取第一个 env: { ... } 块的键名
 *
 * @param {string} content - ecosystem.config.cjs 文件内容
 * @returns {{ keys: string[], corsOrigin: string }}
 */
export function parseEcosystemEnvKeys(content) {
  // 1. 剥离块注释 /* ... */
  const cleaned = content.replace(/\/\*[\s\S]*?\*\//g, '');

  // 2. 用负向后瞻精确匹配 env:（排除 env_production: 等）
  const envMatch = cleaned.match(/(?<![_\w])env\s*:/);
  if (!envMatch) return { keys: [], corsOrigin: '' };

  const envStart = envMatch.index;

  // 3. 找到 { 开始
  const braceStart = cleaned.indexOf('{', envStart);
  if (braceStart === -1) return { keys: [], corsOrigin: '' };

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
  if (braceEnd === -1) return { keys: [], corsOrigin: '' };

  const block = cleaned.slice(braceStart + 1, braceEnd);
  const keys = [];
  let corsOrigin = '';

  // 5. 提取 KEY: value 对，剥离行内注释
  const keyPattern = /^\s*(\w+)\s*:\s*(.+?)(?:,\s*)?$/gm;
  let match;
  while ((match = keyPattern.exec(block)) !== null) {
    keys.push(match[1]);
    if (match[1] === 'CORS_ORIGIN') {
      const raw = match[2];
      // 优先提取引号内的值（避免 https:// 被行内注释正则误伤）
      const quotedMatch = raw.match(/['"]([^'"]*)['"]/);
      corsOrigin = quotedMatch
        ? quotedMatch[1].trim()
        : raw.replace(/\/\/.*$/, '').trim();
    }
  }

  return { keys, corsOrigin };
}
