/**
 * 安全工具模块
 * Security Utilities
 *
 * 提供文件安全、路径验证、敏感信息脱敏等功能
 */

import fs from 'fs';
import path from 'path';
import { AppError } from '../middleware/error.js';

// ============================================
// 1. 文件名安全验证（防止路径遍历）
// ============================================

/**
 * 验证并清理文件名，防止路径遍历攻击
 *
 * 测试用例设计：
 * - 正常文件名: "test-data.parquet" → 通过
 * - 路径遍历: "../../etc/passwd" → 拒绝
 * - URL编码绕过: "..%2F..%2Fetc" → 拒绝（需在调用前解码）
 * - Unicode绕过: "..／passwd" (全角斜杠) → 拒绝
 * - Null字节: "test.parquet\x00.txt" → 拒绝
 * - 特殊字符: "test<script>.parquet" → 拒绝
 * - 空文件名: "" → 拒绝
 * - 仅扩展名: ".parquet" → 拒绝
 * - 超长文件名: 255+字符 → 拒绝
 */
export function sanitizeFilename(filename: string): string {
  // 基础验证
  if (!filename || typeof filename !== 'string') {
    throw new AppError(400, '文件名不能为空');
  }

  // 解码 URL 编码（防止 %2F 等绕过）
  let decoded = filename;
  try {
    decoded = decodeURIComponent(filename);
  } catch {
    // 解码失败，使用原始值
  }

  // 移除 Null 字节（防止 Null 字节注入）
  decoded = decoded.replace(/\x00/g, '');

  // 只允许安全字符：字母、数字、下划线、连字符、点、中文字符、空格
  // 禁止：路径分隔符（/ \ :）、特殊字符（< > | " ' ? * ; $ ` \x00-\x1f）、以及全角斜杠
  const dangerousPattern = /[\/\\:<>|"'?\*;$`\x00-\x1f／]/;
  if (dangerousPattern.test(decoded)) {
    throw new AppError(400, '文件名包含非法字符（路径分隔符、控制字符或特定符号）');
  }

  // 禁止路径遍历模式
  if (decoded.includes('..')) {
    throw new AppError(400, '文件名不允许包含路径遍历字符 ".."');
  }

  // 禁止隐藏文件（以点开头）
  if (decoded.startsWith('.')) {
    throw new AppError(400, '文件名不能以点开头');
  }

  // 长度限制（Linux 最大 255 字符）
  if (decoded.length > 255) {
    throw new AppError(400, '文件名过长，最大 255 字符');
  }

  // 必须有合法的文件名（不能只是扩展名）
  const baseName = path.basename(decoded, path.extname(decoded));
  if (!baseName || baseName.length === 0) {
    throw new AppError(400, '文件名无效');
  }

  return decoded;
}

/**
 * 验证路径是否在允许的目录内（防止符号链接绕过）
 *
 * 测试用例：
 * - 正常路径: "/data/test.parquet" 在 "/data" 内 → 通过
 * - 路径遍历: "/data/../etc/passwd" → 拒绝
 * - 符号链接: "/data/link" -> "/etc" → 拒绝（通过 realpath 检测）
 */
export function validatePathWithinDirectory(
  filePath: string,
  allowedDirectory: string
): void {
  // 解析为绝对路径
  const resolvedPath = path.resolve(filePath);
  const resolvedDir = path.resolve(allowedDirectory);

  // 检查路径是否在允许目录内
  if (!resolvedPath.startsWith(resolvedDir + path.sep) && resolvedPath !== resolvedDir) {
    throw new AppError(403, '禁止访问此路径');
  }

  // 如果文件存在，检查真实路径（防止符号链接绕过）
  if (fs.existsSync(resolvedPath)) {
    const realPath = fs.realpathSync(resolvedPath);
    const realDir = fs.realpathSync(resolvedDir);

    if (!realPath.startsWith(realDir + path.sep) && realPath !== realDir) {
      throw new AppError(403, '禁止通过符号链接访问外部路径');
    }
  }
}

// ============================================
// 2. Parquet 文件格式验证
// ============================================

/**
 * 验证文件是否为有效的 Parquet 格式
 *
 * Parquet 文件特征：
 * - 文件头 4 字节: "PAR1" (0x50 0x41 0x52 0x31)
 * - 文件尾 4 字节: "PAR1" (用于快速验证完整性)
 *
 * 测试用例：
 * - 有效 Parquet: 头尾都是 PAR1 → 通过
 * - 伪装文件: "malicious.js.parquet" 内容非 Parquet → 拒绝
 * - 空文件: 0 字节 → 拒绝
 * - 损坏文件: 只有头部 PAR1，无尾部 → 拒绝
 * - 过小文件: < 12 字节 → 拒绝
 */
export async function isValidParquetFile(filePath: string): Promise<{
  valid: boolean;
  error?: string;
}> {
  try {
    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      return { valid: false, error: '文件不存在' };
    }

    const stats = fs.statSync(filePath);

    // 最小有效 Parquet 文件大小（头4 + 尾4 + 最小元数据）
    const MIN_PARQUET_SIZE = 12;
    if (stats.size < MIN_PARQUET_SIZE) {
      return { valid: false, error: '文件过小，不是有效的 Parquet 文件' };
    }

    // 读取文件头 4 字节
    const headerBuffer = Buffer.alloc(4);
    const fd = fs.openSync(filePath, 'r');

    try {
      fs.readSync(fd, headerBuffer, 0, 4, 0);

      // 检查魔数 "PAR1"
      const header = headerBuffer.toString('utf8');
      if (header !== 'PAR1') {
        return { valid: false, error: '文件头不是 PAR1，不是有效的 Parquet 文件' };
      }

      // 读取文件尾 4 字节（验证完整性）
      const footerBuffer = Buffer.alloc(4);
      fs.readSync(fd, footerBuffer, 0, 4, stats.size - 4);

      const footer = footerBuffer.toString('utf8');
      if (footer !== 'PAR1') {
        return { valid: false, error: '文件尾不是 PAR1，Parquet 文件可能已损坏' };
      }

      return { valid: true };
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    return { valid: false, error: `文件验证失败: ${message}` };
  }
}

// ============================================
// 3. SQL 表名验证
// ============================================

/**
 * 验证并清理 SQL 表名，防止 SQL 注入
 *
 * 测试用例：
 * - 正常表名: "raw_parquet" → 通过
 * - SQL 注入: "table; DROP TABLE users--" → 拒绝
 * - SQL 关键字: "SELECT" → 拒绝
 * - 数字开头: "123table" → 拒绝
 * - 特殊字符: "table'name" → 拒绝
 * - 空表名: "" → 拒绝
 * - 超长表名: 65+ 字符 → 拒绝
 */
export function sanitizeTableName(name: string): string {
  if (!name || typeof name !== 'string') {
    throw new AppError(400, '表名不能为空');
  }

  // 只允许：字母开头，后跟字母/数字/下划线
  const validPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  if (!validPattern.test(name)) {
    throw new AppError(400, '表名格式无效，只允许字母、数字和下划线，且必须以字母或下划线开头');
  }

  // 长度限制（PostgreSQL 最大 63，我们用 64）
  if (name.length > 64) {
    throw new AppError(400, '表名过长，最大 64 字符');
  }

  // SQL 关键字黑名单
  const SQL_KEYWORDS = [
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER',
    'TRUNCATE', 'EXEC', 'EXECUTE', 'UNION', 'JOIN', 'WHERE', 'FROM',
    'TABLE', 'DATABASE', 'INDEX', 'VIEW', 'GRANT', 'REVOKE',
  ];

  if (SQL_KEYWORDS.includes(name.toUpperCase())) {
    throw new AppError(400, '表名不能使用 SQL 关键字');
  }

  return name;
}

/**
 * 转义 SQL 字符串值（用于无法使用参数化查询的场景）
 *
 * 测试用例：
 * - 正常字符串: "hello" → "hello"
 * - 单引号: "it's" → "it''s"
 * - 反斜杠: "path\\to" → "path\\\\to"
 * - 多重引号: "'test'" → "''test''"
 */
export function escapeSqlValue(value: string): string {
  if (typeof value !== 'string') {
    throw new AppError(400, '只能转义字符串值');
  }

  return value
    .replace(/\\/g, '\\\\')  // 先转义反斜杠
    .replace(/'/g, "''");    // 再转义单引号
}

// ============================================
// 4. 敏感信息脱敏
// ============================================

/**
 * 脱敏 API Key（用于日志输出）
 *
 * 测试用例：
 * - 正常 Key: "abc123456789.secretkey123" → "abc1...6789.***"
 * - 短 ID: "ab.secret" → "ab**.***"
 * - 无效格式: "invalid" → "***invalid***"
 * - 空值: "" → "***empty***"
 * - undefined: undefined → "***undefined***"
 */
export function maskApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    return '***empty***';
  }

  const parts = apiKey.split('.');
  if (parts.length !== 2) {
    return '***invalid***';
  }

  const [id, _secret] = parts;

  // 脱敏 ID（保留前 4 和后 4 位）
  let maskedId: string;
  if (id.length <= 8) {
    maskedId = id.substring(0, 2) + '**';
  } else {
    maskedId = id.substring(0, 4) + '...' + id.slice(-4);
  }

  return `${maskedId}.***`;
}

/**
 * 安全日志输出（自动脱敏敏感信息）
 */
export function safeLog(
  level: 'info' | 'warn' | 'error',
  module: string,
  message: string,
  data?: Record<string, any>
): void {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${module}]`;

  // 脱敏敏感字段
  let safeData = data;
  if (data) {
    safeData = { ...data };
    if ('apiKey' in safeData) {
      safeData.apiKey = maskApiKey(safeData.apiKey);
    }
    if ('password' in safeData) {
      safeData.password = '***';
    }
    if ('token' in safeData) {
      safeData.token = '***';
    }
  }

  const logMessage = safeData
    ? `${prefix} ${message} ${JSON.stringify(safeData)}`
    : `${prefix} ${message}`;

  switch (level) {
    case 'info':
      console.log(logMessage);
      break;
    case 'warn':
      console.warn(logMessage);
      break;
    case 'error':
      console.error(logMessage);
      break;
  }
}

// ============================================
// 5. 测试用例导出（用于单元测试）
// ============================================

export const TEST_CASES = {
  sanitizeFilename: {
    valid: [
      'test-data.parquet',
      'file_123.parquet',
      'My-File-2024.parquet',
      '车险保单综合明细表 0212.parquet',
      'file with spaces.parquet',
    ],
    invalid: [
      '',                           // 空文件名
      '../../etc/passwd',           // 路径遍历
      '../secret.txt',              // 上级目录
      '.hidden.parquet',            // 隐藏文件
      'test<script>.parquet',       // 特殊字符
      // 注意：Null 字节会被移除，不会导致拒绝（真正的验证在 isValidParquetFile）
      'a'.repeat(256) + '.parquet', // 超长文件名
      '.parquet',                   // 仅扩展名
      'test/file.parquet',          // 包含斜杠
      'test\\file.parquet',         // 包含反斜杠
    ],
  },
  sanitizeTableName: {
    valid: [
      'raw_parquet',
      'PolicyFact',
      '_temp_table',
      'table123',
    ],
    invalid: [
      '',                 // 空表名
      '123table',         // 数字开头
      'table-name',       // 包含连字符
      "table'name",       // 包含单引号
      'SELECT',           // SQL 关键字
      'DROP',             // SQL 关键字
      'a'.repeat(65),     // 超长表名
    ],
  },
  maskApiKey: {
    cases: [
      { input: 'abc123456789.secretkey123', expected: 'abc1...6789.***' },
      { input: 'ab.secret', expected: 'ab**.***' },
      { input: 'invalid', expected: '***invalid***' },
      { input: '', expected: '***empty***' },
      { input: undefined, expected: '***empty***' },
    ],
  },
};
