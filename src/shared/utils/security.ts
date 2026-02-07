/**
 * Security Utilities
 *
 * Provides input sanitization and validation functions to prevent
 * SQL injection, XSS, and other security vulnerabilities.
 */

/**
 * Security limits configuration
 */
export const SECURITY_LIMITS = {
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
  MAX_FILTER_LENGTH: 100,
  MAX_QUERY_LENGTH: 1000,
  // SQL 查询限制 (SQL Query feature)
  MAX_SQL_LENGTH: 8000, // SQL 语句最大长度 (字符)
  QUERY_TIMEOUT: 30000, // 查询超时时间 (毫秒)
  MAX_RESULT_ROWS: 100000, // 最大结果行数
} as const;

/**
 * Allowed characters for filter inputs (whitelist approach)
 * - Chinese characters: \u4e00-\u9fa5
 * - Letters: a-zA-Z
 * - Numbers: 0-9
 * - Spaces and common separators: \s\-_.()（）【】
 */
const FILTER_PATTERN = /^[\u4e00-\u9fa5a-zA-Z0-9\s\-_.()（）【】]+$/;

/**
 * Dangerous SQL patterns that should never appear in user input
 */
const DANGEROUS_PATTERNS = [
  /['"]/g,        // Quotes
  /;/g,           // Semicolons
  /--/g,          // SQL comments
  /\/\*/g,        // Multi-line comment start
  /\*\//g,        // Multi-line comment end
  /\bOR\b/gi,     // OR keyword (common in tautology attacks)
  /\bAND\b/gi,    // AND keyword
  /\bDROP\b/gi,   // DROP keyword
  /\bDELETE\b/gi, // DELETE keyword
  /\bTRUNCATE\b/gi,// TRUNCATE keyword
  /\bALTER\b/gi,  // ALTER keyword
  /\bEXEC\b/gi,   // EXEC keyword
  /\bEXECUTE\b/gi,// EXECUTE keyword
  /\bUNION\b/gi,  // UNION keyword (potential union-based injection)
  /\bSELECT\b/gi, // SELECT keyword
  /\bINSERT\b/gi, // INSERT keyword
  /\bUPDATE\b/gi, // UPDATE keyword
  /\bWHERE\b/gi,  // WHERE keyword
  /\bFROM\b/gi,   // FROM keyword
  /\bWAITFOR\b/gi,// WAITFOR keyword (time-based injection)
];

/**
 * Sanitize user input to prevent SQL injection
 *
 * This function applies a blacklist approach to remove dangerous patterns.
 * For stricter security, use validateFilterInput() which uses a whitelist.
 *
 * @param input - Raw user input
 * @param maxLength - Maximum allowed length
 * @returns Sanitized input string
 *
 * @example
 * ```tsx
 * const safe = sanitizeInput(userInput, SECURITY_LIMITS.MAX_FILTER_LENGTH);
 * sql = `WHERE name LIKE '%${safe}%'`;
 * ```
 */
export function sanitizeInput(input: string, maxLength: number = SECURITY_LIMITS.MAX_FILTER_LENGTH): string {
  if (!input) return '';

  let sanitized = input;

  // Remove dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    sanitized = sanitized.replace(pattern, '');
  }

  // Limit length
  return sanitized.slice(0, maxLength);
}

/**
 * Validate filter input using whitelist approach
 *
 * This is the most secure validation method - only allows approved characters.
 * Returns true if input is safe, throws error if invalid.
 *
 * @param input - User input to validate
 * @param maxLength - Maximum allowed length
 * @returns true if valid
 * @throws Error if input contains invalid characters or exceeds max length
 *
 * @example
 * ```tsx
 * if (!validateFilterInput(filters.salesman_name)) {
 *   setError('筛选条件包含非法字符');
 *   return;
 * }
 * ```
 */
export function validateFilterInput(input: string, maxLength: number = SECURITY_LIMITS.MAX_FILTER_LENGTH): boolean {
  if (!input) return true;

  // Check length first
  if (input.length > maxLength) {
    throw new Error(`筛选条件过长（${input.length}字符），最大支持${maxLength}字符`);
  }

  // Check against whitelist pattern
  if (!FILTER_PATTERN.test(input)) {
    throw new Error('筛选条件包含非法字符，仅支持中文、字母、数字和常用符号');
  }

  return true;
}

/**
 * Validate uploaded file
 *
 * @param file - File object from file input
 * @returns Object with valid flag and error message
 *
 * @example
 * ```tsx
 * const validation = validateUploadedFile(file);
 * if (!validation.valid) {
 *   setError(validation.error);
 *   return;
 * }
 * ```
 */
export function validateUploadedFile(file: File): { valid: boolean; error?: string } {
  // Check file size
  if (file.size > SECURITY_LIMITS.MAX_FILE_SIZE) {
    const sizeMB = (file.size / 1024 / 1024).toFixed(2);
    const maxMB = (SECURITY_LIMITS.MAX_FILE_SIZE / 1024 / 1024).toFixed(0);
    return {
      valid: false,
      error: `文件过大（${sizeMB}MB），最大支持${maxMB}MB`,
    };
  }

  // Check file extension
  const fileName = file.name.toLowerCase();
  const validExtensions = ['.parquet', '.pq'];
  const hasValidExtension = validExtensions.some(ext => fileName.endsWith(ext));

  if (!hasValidExtension) {
    return {
      valid: false,
      error: `仅支持 ${validExtensions.join(', ')} 格式文件`,
    };
  }

  // Check for suspicious file names (path traversal attempts)
  if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    return {
      valid: false,
      error: '文件名包含非法字符',
    };
  }

  return { valid: true };
}

/**
 * Build a safe SQL LIKE clause
 *
 * Combines validation and sanitization for filter inputs.
 * This is the recommended way to build WHERE clauses with user input.
 *
 * @param columnName - SQL column name (must be hardcoded, not from user)
 * @param userInput - User-provided filter value
 * @returns SQL fragment for LIKE clause, or null if input is empty
 *
 * @example
 * ```tsx
 * const parts = ['1=1'];
 * const orgClause = buildSafeLikeClause('org_level_3', filters.org_level_3);
 * if (orgClause) parts.push(orgClause);
 * const whereClause = parts.join(' AND ');
 * ```
 */
export function buildSafeLikeClause(columnName: string, userInput: string | null | undefined): string | null {
  if (!userInput || userInput.trim() === '') {
    return null;
  }

  try {
    // Step 1: Validate (whitelist)
    validateFilterInput(userInput);

    // Step 2: Sanitize (blacklist - extra protection)
    const safeValue = sanitizeInput(userInput);

    // Step 3: Escape backslashes for SQL
    const escapedValue = safeValue.replace(/\\/g, '\\\\');

    return `${columnName} LIKE '%${escapedValue}%'`;
  } catch (error) {
    // Re-throw with context
    throw error;
  }
}
