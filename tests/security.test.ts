/**
 * Security Utilities Tests
 *
 * Test suite for input sanitization, validation, and SQL injection prevention
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeInput,
  validateFilterInput,
  validateUploadedFile,
  buildSafeLikeClause,
  SECURITY_LIMITS,
} from '../src/shared/utils/security';

describe('sanitizeInput', () => {
  it('should remove SQL injection patterns', () => {
    const dangerous = "'; DROP TABLE users; --";
    const safe = sanitizeInput(dangerous);

    expect(safe).not.toContain("'");
    expect(safe).not.toContain(';');
    expect(safe).not.toContain('--');
    expect(safe).not.toContain('DROP');
  });

  it('should handle union-based injection attempts', () => {
    const injection = "admin' UNION SELECT * FROM passwords--";
    const safe = sanitizeInput(injection);

    expect(safe).not.toContain('UNION');
    expect(safe).not.toContain('SELECT');
    expect(safe).not.toContain("'");
  });

  it('should remove quotes', () => {
    expect(sanitizeInput("John's")).toBe('Johns');
    expect(sanitizeInput('"hello"')).toBe('hello');
  });

  it('should enforce max length', () => {
    const longInput = 'a'.repeat(200);
    const result = sanitizeInput(longInput, 100);

    expect(result.length).toBe(100);
  });

  it('should preserve safe Chinese characters', () => {
    const input = '张三 李四 王五';
    const result = sanitizeInput(input);

    expect(result).toBe(input);
  });

  it('should preserve safe alphanumeric input', () => {
    const input = 'John Doe 123';
    const result = sanitizeInput(input);

    expect(result).toBe(input);
  });

  it('should handle empty input', () => {
    expect(sanitizeInput('')).toBe('');
    expect(sanitizeInput('   ')).toBe('   ');
  });

  it('should remove multiple dangerous keywords', () => {
    const dangerous = "'; DROP TABLE users; EXEC xp_cmdshell('dir'); --";
    const safe = sanitizeInput(dangerous);

    expect(safe).not.toContain('DROP');
    expect(safe).not.toContain('EXEC');
  });
});

describe('validateFilterInput', () => {
  it('should accept valid Chinese input', () => {
    expect(() => validateFilterInput('张三')).not.toThrow();
    expect(() => validateFilterInput('北京分公司')).not.toThrow();
  });

  it('should accept valid alphanumeric input', () => {
    expect(() => validateFilterInput('John Doe')).not.toThrow();
    expect(() => validateFilterInput('user_123')).not.toThrow();
  });

  it('should accept mixed input', () => {
    expect(() => validateFilterInput('张三 John')).not.toThrow();
  });

  it('should accept safe special characters', () => {
    expect(() => validateFilterInput('John-Doe')).not.toThrow();
    expect(() => validateFilterInput('John Doe Jr.')).not.toThrow();
    expect(() => validateFilterInput('北京（朝阳）')).not.toThrow();
    expect(() => validateFilterInput('Sales【2024】')).not.toThrow();
  });

  it('should reject SQL injection attempts', () => {
    expect(() => validateFilterInput("'; DROP TABLE--")).toThrow();
    expect(() => validateFilterInput("admin' OR '1'='1")).toThrow();
  });

  it('should reject input longer than max length', () => {
    const longInput = 'a'.repeat(101);
    expect(() => validateFilterInput(longInput, 100)).toThrow();
  });

  it('should reject dangerous special characters', () => {
    expect(() => validateFilterInput('John&Doe')).toThrow();
    expect(() => validateFilterInput('John|Doe')).toThrow();
    expect(() => validateFilterInput('John$Doe')).toThrow();
  });

  it('should return true for empty input', () => {
    expect(validateFilterInput('')).toBe(true);
    expect(validateFilterInput('   ')).toBe(true);
  });
});

describe('validateUploadedFile', () => {
  it('should accept valid parquet files', () => {
    const content = 'x'.repeat(1024 * 1024); // 1MB
    const file = new File([content], 'data.parquet', {
      type: 'application/octet-stream',
    });

    const result = validateUploadedFile(file);
    expect(result.valid).toBe(true);
  });

  it('should accept .pq extension', () => {
    const file = new File(['content'], 'data.pq', {
      type: 'application/octet-stream',
    });

    const result = validateUploadedFile(file);
    expect(result.valid).toBe(true);
  });

  it('should reject files exceeding max size', () => {
    const content = 'x'.repeat(SECURITY_LIMITS.MAX_FILE_SIZE + 1);
    const file = new File([content], 'large.parquet');

    const result = validateUploadedFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('文件过大');
  });

  it('should reject non-parquet files', () => {
    const file = new File(['content'], 'data.exe');

    const result = validateUploadedFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('仅支持');
  });

  it('should reject path traversal attempts in filename', () => {
    const file = new File(['content'], '../../etc/passwd.parquet');

    const result = validateUploadedFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('非法字符');
  });

  it('should reject Windows path traversal', () => {
    const file = new File(['content'], '..\\..\\windows\\system32.parquet');

    const result = validateUploadedFile(file);
    expect(result.valid).toBe(false);
  });

  it('be case insensitive for extension', () => {
    const file = new File(['content'], 'DATA.PARQUET');

    const result = validateUploadedFile(file);
    expect(result.valid).toBe(true);
  });
});

describe('buildSafeLikeClause', () => {
  it('should build correct LIKE clause for valid input', () => {
    const result = buildSafeLikeClause('salesman_name', 'John');
    expect(result).toBe("salesman_name LIKE '%John%'");
  });

  it('should handle Chinese input', () => {
    const result = buildSafeLikeClause('org_level_3', '北京');
    expect(result).toBe("org_level_3 LIKE '%北京%'");
  });

  it('should return null for empty input', () => {
    expect(buildSafeLikeClause('col1', '')).toBeNull();
    expect(buildSafeLikeClause('col1', '   ')).toBeNull();
    expect(buildSafeLikeClause('col1', null)).toBeNull();
    expect(buildSafeLikeClause('col1', undefined)).toBeNull();
  });

  it('should throw error for dangerous patterns', () => {
    // buildSafeLikeClause uses validateFilterInput (whitelist), so it throws on illegal chars
    expect(() => buildSafeLikeClause('col1', "'; DROP TABLE--")).toThrow();
  });

  it('should escape backslashes', () => {
    // Backslashes are not in the whitelist, so this will throw
    expect(() => buildSafeLikeClause('col1', 'test\\value')).toThrow();
  });

  it('should throw error for invalid input', () => {
    expect(() => buildSafeLikeClause('col1', 'John&Doe')).toThrow();
  });

  it('should throw error for input exceeding max length', () => {
    const longInput = 'a'.repeat(101);
    expect(() => buildSafeLikeClause('col1', longInput)).toThrow();
  });
});

describe('SECURITY_LIMITS', () => {
  it('should have reasonable file size limit', () => {
    expect(SECURITY_LIMITS.MAX_FILE_SIZE).toBe(50 * 1024 * 1024); // 50MB
  });

  it('should have reasonable filter length limit', () => {
    expect(SECURITY_LIMITS.MAX_FILTER_LENGTH).toBe(100);
  });

  it('should have reasonable query length limit', () => {
    expect(SECURITY_LIMITS.MAX_QUERY_LENGTH).toBe(1000);
  });
});

describe('SQL Injection Attack Scenarios', () => {
  describe('Classic SQL Injection', () => {
    it('should prevent tautology attacks', () => {
      const attack = "admin' OR '1'='1";
      const safe = sanitizeInput(attack);

      expect(safe).not.toContain('OR');
      expect(safe).not.toContain("'");
    });

    it('should prevent union-based attacks', () => {
      const attack = "' UNION SELECT * FROM users--";
      const safe = sanitizeInput(attack);

      expect(safe).not.toContain('UNION');
      expect(safe).not.toContain('SELECT');
    });

    it('should prevent comment-based attacks', () => {
      const attack = "admin';--";
      const safe = sanitizeInput(attack);

      expect(safe).not.toContain('--');
      expect(safe).not.toContain("'");
    });
  });

  describe('Advanced SQL Injection', () => {
    it('should prevent stacked queries', () => {
      const attack = "'; DROP TABLE users; SELECT * FROM data--";
      const safe = sanitizeInput(attack);

      expect(safe).not.toContain('DROP');
      expect(safe).not.toContain(';');
    });

    it('should prevent time-based blind attacks', () => {
      const attack = "'; WAITFOR DELAY '00:00:10'--";
      const safe = sanitizeInput(attack);

      expect(safe).not.toContain('WAITFOR');
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle salesman name filter safely', () => {
      const userInput = "张三' OR '1'='1";
      expect(() => validateFilterInput(userInput)).toThrow();
    });

    it('should handle org filter safely', () => {
      const userInput = "北京'; DROP TABLE PolicyFact; --";
      expect(() => validateFilterInput(userInput)).toThrow();
    });

    it('should prevent file upload with malicious name', () => {
      const file = new File(['content'], '../../etc/passwd.parquet');

      const result = validateUploadedFile(file);
      expect(result.valid).toBe(false);
    });
  });
});
