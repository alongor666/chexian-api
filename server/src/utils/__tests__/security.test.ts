/**
 * 安全工具模块测试
 * Security Utilities Tests
 *
 * 验证所有安全修复的有效性
 * 包含边缘情况和攻击向量测试
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeFilename,
  sanitizeTableName,
  maskApiKey,
  escapeSqlValue,
  TEST_CASES,
} from '../security';

describe('sanitizeFilename - 文件名安全验证', () => {
  describe('应该接受有效的文件名', () => {
    const validCases = [
      'test-data.parquet',
      'file_123.parquet',
      'My-File-2024.parquet',
      'a.parquet',
      '123.txt',
      'test_file_v2.0.parquet',
    ];

    validCases.forEach((filename) => {
      it(`接受: "${filename}"`, () => {
        expect(() => sanitizeFilename(filename)).not.toThrow();
        expect(sanitizeFilename(filename)).toBe(filename);
      });
    });
  });

  describe('应该拒绝路径遍历攻击', () => {
    const pathTraversalCases = [
      { input: '../../etc/passwd', desc: '上级目录遍历' },
      { input: '../secret.txt', desc: '单层遍历' },
      { input: '....//....//etc/passwd', desc: '双点双斜杠绕过' },
      { input: '..\\..\\windows\\system32', desc: 'Windows 风格遍历' },
    ];

    pathTraversalCases.forEach(({ input, desc }) => {
      it(`拒绝 ${desc}: "${input}"`, () => {
        expect(() => sanitizeFilename(input)).toThrow();
      });
    });
  });

  describe('应该拒绝特殊字符注入', () => {
    const specialCharCases = [
      { input: 'test<script>.parquet', desc: 'HTML 标签' },
      { input: 'test"file.parquet', desc: '双引号' },
      { input: "test'file.parquet", desc: '单引号' },
      { input: 'test;rm -rf.parquet', desc: '命令注入' },
      { input: 'test|cat /etc/passwd.parquet', desc: '管道注入' },
      { input: 'test`whoami`.parquet', desc: '反引号注入' },
      { input: 'test$(id).parquet', desc: '命令替换' },
      { input: 'test file.parquet', desc: '空格' },
      { input: 'test\tfile.parquet', desc: '制表符' },
      { input: 'test\nfile.parquet', desc: '换行符' },
    ];

    specialCharCases.forEach(({ input, desc }) => {
      it(`拒绝 ${desc}: "${input.replace(/[\n\t]/g, '\\n')}"`, () => {
        expect(() => sanitizeFilename(input)).toThrow();
      });
    });
  });

  describe('应该正确处理 Null 字节', () => {
    it('移除 Null 字节后验证结果: "test.parquet\\x00.txt"', () => {
      const input = 'test.parquet\x00.txt';
      // Null 字节被移除后，变成 "test.parquet.txt"，这是有效的文件名
      // 真正的扩展名验证在 isValidParquetFile() 中进行（魔数检查）
      const result = sanitizeFilename(input);
      expect(result).toBe('test.parquet.txt');
      // 关键安全保证：Null 字节已被移除
      expect(result).not.toContain('\x00');
    });

    it('移除多个 Null 字节', () => {
      const input = 'test\x00data\x00.parquet';
      const result = sanitizeFilename(input);
      expect(result).toBe('testdata.parquet');
      expect(result).not.toContain('\x00');
    });
  });

  describe('应该拒绝隐藏文件和无效格式', () => {
    const invalidCases = [
      { input: '.hidden.parquet', desc: '隐藏文件' },
      { input: '.parquet', desc: '仅扩展名' },
      { input: '', desc: '空文件名' },
      { input: 'a'.repeat(256), desc: '超长文件名' },
    ];

    invalidCases.forEach(({ input, desc }) => {
      it(`拒绝 ${desc}`, () => {
        expect(() => sanitizeFilename(input)).toThrow();
      });
    });
  });

  describe('应该拒绝路径分隔符', () => {
    const pathSeparatorCases = [
      { input: 'test/file.parquet', desc: 'Unix 斜杠' },
      { input: 'test\\file.parquet', desc: 'Windows 反斜杠' },
      { input: 'dir/subdir/file.parquet', desc: '多级路径' },
    ];

    pathSeparatorCases.forEach(({ input, desc }) => {
      it(`拒绝 ${desc}: "${input}"`, () => {
        expect(() => sanitizeFilename(input)).toThrow();
      });
    });
  });
});

describe('sanitizeTableName - SQL 表名安全验证', () => {
  describe('应该接受有效的表名', () => {
    const validCases = [
      'raw_parquet',
      'PolicyFact',
      '_temp_table',
      'table123',
      'MyTable_v2',
    ];

    validCases.forEach((name) => {
      it(`接受: "${name}"`, () => {
        expect(() => sanitizeTableName(name)).not.toThrow();
        expect(sanitizeTableName(name)).toBe(name);
      });
    });
  });

  describe('应该拒绝 SQL 注入尝试', () => {
    const sqlInjectionCases = [
      { input: "table'; DROP TABLE users--", desc: 'DROP 注入' },
      { input: 'table; DELETE FROM users', desc: 'DELETE 注入' },
      { input: "table UNION SELECT * FROM passwords--", desc: 'UNION 注入' },
      { input: 'table/*comment*/', desc: '注释注入' },
    ];

    sqlInjectionCases.forEach(({ input, desc }) => {
      it(`拒绝 ${desc}`, () => {
        expect(() => sanitizeTableName(input)).toThrow();
      });
    });
  });

  describe('应该拒绝 SQL 关键字', () => {
    const keywords = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE'];

    keywords.forEach((keyword) => {
      it(`拒绝关键字: "${keyword}"`, () => {
        expect(() => sanitizeTableName(keyword)).toThrow();
      });

      it(`拒绝小写关键字: "${keyword.toLowerCase()}"`, () => {
        expect(() => sanitizeTableName(keyword.toLowerCase())).toThrow();
      });
    });
  });

  describe('应该拒绝无效格式', () => {
    const invalidCases = [
      { input: '', desc: '空表名' },
      { input: '123table', desc: '数字开头' },
      { input: 'table-name', desc: '包含连字符' },
      { input: "table'name", desc: '包含单引号' },
      { input: 'table name', desc: '包含空格' },
      { input: 'a'.repeat(65), desc: '超长表名' },
    ];

    invalidCases.forEach(({ input, desc }) => {
      it(`拒绝 ${desc}`, () => {
        expect(() => sanitizeTableName(input)).toThrow();
      });
    });
  });
});

describe('maskApiKey - API Key 脱敏', () => {
  it('应该正确脱敏正常的 API Key', () => {
    expect(maskApiKey('abc123456789.secretkey123')).toBe('abc1...6789.***');
  });

  it('应该处理短 ID', () => {
    expect(maskApiKey('ab.secret')).toBe('ab**.***');
  });

  it('应该处理无效格式', () => {
    expect(maskApiKey('invalid')).toBe('***invalid***');
    expect(maskApiKey('a.b.c')).toBe('***invalid***');
  });

  it('应该处理空值', () => {
    expect(maskApiKey('')).toBe('***empty***');
    expect(maskApiKey(undefined)).toBe('***empty***');
  });

  it('不应该泄露完整的 API Key', () => {
    const apiKey = 'myapikey12345.supersecretkey';
    const masked = maskApiKey(apiKey);

    // 确保完整的 ID 和 secret 都没有出现
    expect(masked).not.toContain('myapikey12345');
    expect(masked).not.toContain('supersecretkey');
    expect(masked).toContain('***');
  });
});

describe('escapeSqlValue - SQL 值转义', () => {
  it('应该转义单引号', () => {
    expect(escapeSqlValue("it's")).toBe("it''s");
    expect(escapeSqlValue("test''value")).toBe("test''''value");
  });

  it('应该转义反斜杠', () => {
    expect(escapeSqlValue('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  it('应该处理混合情况', () => {
    expect(escapeSqlValue("it's a\\test")).toBe("it''s a\\\\test");
  });

  it('应该保持普通字符串不变', () => {
    expect(escapeSqlValue('normal string')).toBe('normal string');
    expect(escapeSqlValue('123')).toBe('123');
  });
});

describe('边缘情况综合测试', () => {
  describe('Unicode 和编码绕过', () => {
    it('应该拒绝全角斜杠', () => {
      // 全角斜杠 U+FF0F
      expect(() => sanitizeFilename('test／file.parquet')).toThrow();
    });

    it('应该拒绝 URL 编码路径', () => {
      // %2F = /
      // 注意：sanitizeFilename 假设输入已解码
      const decoded = decodeURIComponent('..%2F..%2Fetc%2Fpasswd');
      expect(() => sanitizeFilename(decoded)).toThrow();
    });
  });

  describe('组合攻击向量', () => {
    it('应该拒绝路径遍历 + SQL 注入组合', () => {
      expect(() => sanitizeFilename("../../'; DROP TABLE--")).toThrow();
    });

    it('应该移除 Null 字节（扩展名绕过由魔数验证处理）', () => {
      // Null 字节被移除，结果是 "malicious.php.parquet"
      // 这是有效的文件名，但文件格式验证会在 isValidParquetFile() 中进行
      const result = sanitizeFilename('malicious.php\x00.parquet');
      expect(result).toBe('malicious.php.parquet');
      expect(result).not.toContain('\x00');
    });
  });
});

describe('TEST_CASES 导出验证', () => {
  it('应该导出测试用例常量', () => {
    expect(TEST_CASES).toBeDefined();
    expect(TEST_CASES.sanitizeFilename).toBeDefined();
    expect(TEST_CASES.sanitizeTableName).toBeDefined();
    expect(TEST_CASES.maskApiKey).toBeDefined();
  });

  it('所有 sanitizeFilename.valid 用例应该通过', () => {
    TEST_CASES.sanitizeFilename.valid.forEach((filename) => {
      expect(() => sanitizeFilename(filename)).not.toThrow();
    });
  });

  it('所有 sanitizeFilename.invalid 用例应该失败', () => {
    TEST_CASES.sanitizeFilename.invalid.forEach((filename) => {
      expect(() => sanitizeFilename(filename)).toThrow();
    });
  });

  it('所有 sanitizeTableName.valid 用例应该通过', () => {
    TEST_CASES.sanitizeTableName.valid.forEach((name) => {
      expect(() => sanitizeTableName(name)).not.toThrow();
    });
  });

  it('所有 sanitizeTableName.invalid 用例应该失败', () => {
    TEST_CASES.sanitizeTableName.invalid.forEach((name) => {
      expect(() => sanitizeTableName(name)).toThrow();
    });
  });

  it('所有 maskApiKey 用例应该返回预期结果', () => {
    TEST_CASES.maskApiKey.cases.forEach(({ input, expected }) => {
      expect(maskApiKey(input)).toBe(expected);
    });
  });
});
