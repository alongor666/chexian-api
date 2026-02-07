/**
 * systemPrompt 单元测试
 */

import { describe, it, expect } from 'vitest';
import { extractSqlFromResponse, SYSTEM_PROMPT } from '../systemPrompt';

describe('extractSqlFromResponse', () => {
  it('should extract SQL from ```sql code block', () => {
    const response = `这是一个查询：
\`\`\`sql
SELECT org_level_3 AS "机构",
  SUM(premium) AS "总保费"
FROM PolicyFact
GROUP BY org_level_3
\`\`\`
以上是生成的SQL。`;

    const sql = extractSqlFromResponse(response);
    expect(sql).toContain('SELECT org_level_3');
    expect(sql).toContain('SUM(premium)');
    expect(sql).toContain('FROM PolicyFact');
    expect(sql).not.toContain('```');
  });

  it('should extract SQL from generic ``` code block', () => {
    const response = `\`\`\`
SELECT * FROM PolicyFact LIMIT 10
\`\`\``;

    const sql = extractSqlFromResponse(response);
    expect(sql).toBe('SELECT * FROM PolicyFact LIMIT 10');
  });

  it('should return raw SELECT statement if no code block', () => {
    const response = 'SELECT org_level_3, SUM(premium) FROM PolicyFact GROUP BY org_level_3';

    const sql = extractSqlFromResponse(response);
    expect(sql).toBe(response);
  });

  it('should return raw WITH statement if no code block', () => {
    const response = 'WITH cte AS (SELECT * FROM PolicyFact) SELECT * FROM cte';

    const sql = extractSqlFromResponse(response);
    expect(sql).toBe(response);
  });

  it('should trim whitespace', () => {
    const response = `

\`\`\`sql
SELECT 1
\`\`\`

`;

    const sql = extractSqlFromResponse(response);
    expect(sql).toBe('SELECT 1');
  });

  it('should handle response without SQL', () => {
    const response = '抱歉，我无法理解您的查询。';

    const sql = extractSqlFromResponse(response);
    expect(sql).toBe(response);
  });
});

describe('SYSTEM_PROMPT', () => {
  it('should contain PolicyFact table reference', () => {
    expect(SYSTEM_PROMPT).toContain('PolicyFact');
  });

  it('should contain dimension fields', () => {
    expect(SYSTEM_PROMPT).toContain('org_level_3');
    expect(SYSTEM_PROMPT).toContain('salesman_name');
    expect(SYSTEM_PROMPT).toContain('customer_category');
  });

  it('should contain measure fields', () => {
    expect(SYSTEM_PROMPT).toContain('premium');
    expect(SYSTEM_PROMPT).toContain('policy_no');
  });

  it('should contain privacy protection rules', () => {
    expect(SYSTEM_PROMPT).toContain('隐私保护');
    expect(SYSTEM_PROMPT).toContain('COUNT DISTINCT');
  });

  it('should contain example queries', () => {
    expect(SYSTEM_PROMPT).toContain('2025年起保分客户类别');
    expect(SYSTEM_PROMPT).toContain('各机构保费排名');
    expect(SYSTEM_PROMPT).toContain('新能源车占比');
  });
});
