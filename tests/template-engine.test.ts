/**
 * 模板引擎单元测试
 *
 * 测试覆盖：
 * - SQL 值转义（防注入）
 * - 占位符插值
 * - 条件逻辑处理
 * - 参数验证
 * - 综合 SQL 生成
 */

import { describe, it, expect } from 'vitest';
import {
  escapeSQLValue,
  interpolateSQL,
  validateParameterValue,
  extractGlobalFilters,
  generateSQL,
} from '../src/shared/utils/templateEngine';
import type { QueryParameter } from '../src/shared/types/sql-query';

describe('templateEngine', () => {
  describe('escapeSQLValue', () => {
    it('应该正确转义 NULL 值', () => {
      expect(escapeSQLValue(null)).toBe('NULL');
      expect(escapeSQLValue(undefined)).toBe('NULL');
    });

    it('应该正确处理数字', () => {
      expect(escapeSQLValue(123)).toBe('123');
      expect(escapeSQLValue(0)).toBe('0');
      expect(escapeSQLValue(-45.67)).toBe('-45.67');
    });

    it('应该拒绝非法数字', () => {
      expect(() => escapeSQLValue(NaN)).toThrow('Invalid number value');
      expect(() => escapeSQLValue(Infinity)).toThrow('Invalid number value');
    });

    it('应该正确处理布尔值', () => {
      expect(escapeSQLValue(true)).toBe('1');
      expect(escapeSQLValue(false)).toBe('0');
    });

    it('应该正确处理字符串', () => {
      expect(escapeSQLValue('hello')).toBe("'hello'");
      expect(escapeSQLValue('')).toBe("''");
    });

    it('应该转义单引号', () => {
      expect(escapeSQLValue("O'Brien")).toBe("'O''Brien'");
      expect(escapeSQLValue("it's")).toBe("'it''s'");
    });

    it('应该转义特殊字符', () => {
      const result = escapeSQLValue('test\nline\tbreak');
      expect(result).toContain('\\n');
      expect(result).toContain('\\t');
    });

    it('应该正确处理数组（IN 子句）', () => {
      expect(escapeSQLValue([1, 2, 3])).toBe('(1, 2, 3)');
      expect(escapeSQLValue(['a', 'b'])).toBe("('a', 'b')");
    });

    it('应该拒绝空数组', () => {
      expect(() => escapeSQLValue([])).toThrow('Array parameter cannot be empty');
    });

    it('应该正确处理日期', () => {
      const date = new Date('2026-01-08');
      expect(escapeSQLValue(date)).toBe("'2026-01-08'");
    });

    it('应该防止 SQL 注入', () => {
      const malicious = "'; DROP TABLE users; --";
      const escaped = escapeSQLValue(malicious);
      // 应该将整个字符串包裹在引号内，并转义内部的单引号
      expect(escaped).toBe("'''; DROP TABLE users; --'");
      // 关键：整个危险字符串应该被当作字符串字面值，而不是SQL语句
      expect(escaped.startsWith("'")).toBe(true);
      expect(escaped.endsWith("'")).toBe(true);
    });
  });

  describe('interpolateSQL', () => {
    it('应该替换简单占位符', () => {
      const template = 'SELECT * FROM users WHERE name = {{name}}';
      const params = { name: 'Alice' };
      const result = interpolateSQL(template, params);
      expect(result).toBe("SELECT * FROM users WHERE name = 'Alice'");
    });

    it('应该替换多个占位符', () => {
      const template = 'SELECT {{field}} FROM {{table}} LIMIT {{limit}}';
      const params = { field: 'id', table: 'users', limit: 10 };
      const result = interpolateSQL(template, params);
      expect(result).toBe("SELECT 'id' FROM 'users' LIMIT 10");
    });

    it('应该处理条件逻辑 {{#if}}', () => {
      const template = 'SELECT * FROM users {{#if active}}WHERE active = 1{{/if}}';

      const resultWithActive = interpolateSQL(template, { active: true });
      expect(resultWithActive).toBe('SELECT * FROM users WHERE active = 1');

      const resultWithoutActive = interpolateSQL(template, { active: false });
      expect(resultWithoutActive).toBe('SELECT * FROM users ');
    });

    it('应该处理条件取反 {{#unless}}', () => {
      const template = 'SELECT * FROM users {{#unless deleted}}WHERE deleted = 0{{/unless}}';

      const resultNotDeleted = interpolateSQL(template, { deleted: false });
      expect(resultNotDeleted).toBe('SELECT * FROM users WHERE deleted = 0');

      const resultDeleted = interpolateSQL(template, { deleted: true });
      expect(resultDeleted).toBe('SELECT * FROM users ');
    });

    it('应该处理嵌套条件', () => {
      const template =
        'SELECT * FROM users WHERE 1=1 {{#if name}}AND name = {{name}}{{/if}} {{#if age}}AND age > {{age}}{{/if}}';
      const params = { name: 'Bob', age: 18 };
      const result = interpolateSQL(template, params);
      expect(result).toContain("AND name = 'Bob'");
      expect(result).toContain('AND age > 18');
    });

    it('应该在缺少必需参数时抛出错误', () => {
      const template = 'SELECT * FROM users WHERE id = {{user_id}}';
      const params = { name: 'Alice' }; // 缺少 user_id
      expect(() => interpolateSQL(template, params)).toThrow('缺少必需的参数: user_id');
    });

    it('应该支持禁用转义（谨慎使用）', () => {
      const template = 'SELECT * FROM users WHERE {{raw_condition}}';
      const params = { raw_condition: 'age > 18' };
      const result = interpolateSQL(template, params, { escape: false });
      expect(result).toBe('SELECT * FROM users WHERE age > 18');
    });
  });

  describe('validateParameterValue', () => {
    it('应该验证必填参数', () => {
      const param: QueryParameter = {
        name: 'username',
        label: '用户名',
        type: 'text',
        required: true,
      };

      expect(() => validateParameterValue(null, param)).toThrow('用户名" 是必填项');
      expect(() => validateParameterValue('', param)).toThrow('用户名" 是必填项');
      expect(() => validateParameterValue('Alice', param)).not.toThrow();
    });

    it('应该验证数字范围', () => {
      const param: QueryParameter = {
        name: 'age',
        label: '年龄',
        type: 'number',
        required: true,
        validation: { min: 0, max: 120, message: '年龄必须在0-120之间' },
      };

      expect(() => validateParameterValue(-1, param)).toThrow('年龄必须在0-120之间');
      expect(() => validateParameterValue(150, param)).toThrow('年龄必须在0-120之间');
      expect(() => validateParameterValue(25, param)).not.toThrow();
    });

    it('应该验证日期格式', () => {
      const param: QueryParameter = {
        name: 'birth_date',
        label: '出生日期',
        type: 'date',
        required: true,
      };

      expect(() => validateParameterValue('2026-01-08', param)).not.toThrow();
      expect(() => validateParameterValue('invalid-date', param)).toThrow('YYYY-MM-DD 格式');
      expect(() => validateParameterValue(new Date(), param)).not.toThrow();
    });

    it('应该验证文本正则', () => {
      const param: QueryParameter = {
        name: 'email',
        label: '邮箱',
        type: 'text',
        required: true,
        validation: {
          pattern: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
          message: '邮箱格式不正确',
        },
      };

      expect(() => validateParameterValue('test@example.com', param)).not.toThrow();
      expect(() => validateParameterValue('invalid-email', param)).toThrow('邮箱格式不正确');
    });

    it('应该验证选项值', () => {
      const param: QueryParameter = {
        name: 'role',
        label: '角色',
        type: 'select',
        required: true,
        options: [
          { label: '管理员', value: 'admin' },
          { label: '用户', value: 'user' },
        ],
      };

      expect(() => validateParameterValue('admin', param)).not.toThrow();
      expect(() => validateParameterValue('invalid', param)).toThrow('包含无效的选项');
    });

    it('应该允许非必填参数为空', () => {
      const param: QueryParameter = {
        name: 'nickname',
        label: '昵称',
        type: 'text',
        required: false,
      };

      expect(() => validateParameterValue(null, param)).not.toThrow();
      expect(() => validateParameterValue('', param)).not.toThrow();
    });
  });

  describe('extractGlobalFilters', () => {
    it('应该从全局筛选器中提取参数', () => {
      const parameters: QueryParameter[] = [
        {
          name: 'date_from',
          label: '开始日期',
          type: 'date',
          required: false,
          inheritsGlobalFilter: true,
          globalFilterKey: 'policy_date_start',
        },
        {
          name: 'org',
          label: '机构',
          type: 'text',
          required: false,
          inheritsGlobalFilter: true,
          globalFilterKey: 'org_level_3',
        },
      ];

      const globalFilters = {
        policy_date_start: '2026-01-01',
        org_level_3: '成都分公司',
      };

      const extracted = extractGlobalFilters(parameters, globalFilters);
      expect(extracted).toEqual({
        date_from: '2026-01-01',
        org: '成都分公司',
      });
    });

    it('应该忽略未配置继承的参数', () => {
      const parameters: QueryParameter[] = [
        {
          name: 'limit',
          label: '数量',
          type: 'number',
          required: true,
          inheritsGlobalFilter: false,
        },
      ];

      const globalFilters = { policy_date_start: '2026-01-01' };
      const extracted = extractGlobalFilters(parameters, globalFilters);
      expect(extracted).toEqual({});
    });
  });

  describe('generateSQL', () => {
    it('应该生成字符串模板的 SQL', () => {
      const template = 'SELECT * FROM users WHERE age > {{age}} LIMIT {{limit}}';
      const parameters: QueryParameter[] = [
        { name: 'age', label: '年龄', type: 'number', required: true },
        { name: 'limit', label: '数量', type: 'number', required: true },
      ];
      const paramValues = { age: 18, limit: 10 };

      const result = generateSQL(template, parameters, paramValues);
      expect(result).toBe('SELECT * FROM users WHERE age > 18 LIMIT 10');
    });

    it('应该生成函数类型的 SQL', () => {
      const template = (params: Record<string, any>) => {
        return `SELECT * FROM users WHERE age > ${params.age} LIMIT ${params.limit}`;
      };
      const parameters: QueryParameter[] = [
        { name: 'age', label: '年龄', type: 'number', required: true },
        { name: 'limit', label: '数量', type: 'number', required: true },
      ];
      const paramValues = { age: 18, limit: 10 };

      const result = generateSQL(template, parameters, paramValues);
      expect(result).toBe('SELECT * FROM users WHERE age > 18 LIMIT 10');
    });

    it('应该合并全局筛选器和用户参数', () => {
      const template = 'SELECT * FROM users WHERE created >= {{date_from}} AND age > {{age}}';
      const parameters: QueryParameter[] = [
        {
          name: 'date_from',
          label: '开始日期',
          type: 'date',
          required: false,
          inheritsGlobalFilter: true,
          globalFilterKey: 'policy_date_start',
        },
        { name: 'age', label: '年龄', type: 'number', required: true },
      ];
      const paramValues = { age: 18 };
      const globalFilters = { policy_date_start: '2026-01-01' };

      const result = generateSQL(template, parameters, paramValues, globalFilters);
      expect(result).toContain("created >= '2026-01-01'");
      expect(result).toContain('age > 18');
    });

    it('应该在参数验证失败时抛出错误', () => {
      const template = 'SELECT * FROM users WHERE age > {{age}}';
      const parameters: QueryParameter[] = [
        {
          name: 'age',
          label: '年龄',
          type: 'number',
          required: true,
          validation: { min: 0, max: 120 },
        },
      ];
      const paramValues = { age: 150 }; // 超出范围

      expect(() => generateSQL(template, parameters, paramValues)).toThrow('参数验证失败');
    });
  });
});
