import { describe, expect, it } from 'vitest';
import { NORMALIZED_AGENT_NAME_SQL, buildNormalizedAgentNameInCondition } from '../agent-name.js';
import { buildConditionsFromFilterParams, commonFilterSchema } from '../filter-params.js';

describe('经代名称精确筛选', () => {
  it('与 PIVOT 维度同口径，只剥前导机构码并显式保留无经代', () => {
    expect(NORMALIZED_AGENT_NAME_SQL).toBe(
      "COALESCE(NULLIF(TRIM(REGEXP_REPLACE(agent_name, '^[0-9]+', '')), ''), '无经代')",
    );
  });

  it('按完整名称生成精确 IN，不使用 LIKE 或短名归并', () => {
    const condition = buildNormalizedAgentNameInCondition([
      '中国邮政集团有限公司山西省分公司',
      '中国邮政储蓄银行股份有限公司山西省分行',
    ]);
    expect(condition).toContain("IN ('中国邮政集团有限公司山西省分公司', '中国邮政储蓄银行股份有限公司山西省分行')");
    expect(condition).not.toContain('LIKE');
  });

  it('commonFilterSchema 接受 agentNames 并把它落实到 WHERE', () => {
    const parsed = commonFilterSchema.parse({
      agentNames: '中国邮政集团有限公司山西省分公司',
    });
    expect(buildConditionsFromFilterParams(parsed)).toContain(
      `${NORMALIZED_AGENT_NAME_SQL} IN ('中国邮政集团有限公司山西省分公司')`,
    );
  });
});
