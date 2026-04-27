/**
 * data-health Skill — 阶段 1
 *
 * 检查数据是否就绪、关键字段是否存在、period 内是否有样本。
 * 纯确定性，零 LLM 依赖。
 */

import { z } from 'zod';
import type { Skill } from '../types.js';
import { PeriodSchema } from '../types.js';
import { buildPeriodWhere, runSql, listLoadedRelations, relationExists } from '../adapters/query-adapter.js';

const InputSchema = z.object({
  period: PeriodSchema,
  /** 期望覆盖的字段（用于完整度检查），默认核心 7 字段 */
  requiredFields: z
    .array(z.string())
    .default(['premium', 'reported_claims', 'policy_date', 'org_level_3', 'vehicle_type', 'plate_region', 'is_nev']),
  /** 期望覆盖的数据域（表名），默认 PolicyFact */
  requiredDomains: z.array(z.string()).default(['PolicyFact']),
});

const FieldGapSchema = z.object({
  field: z.string(),
  nullCount: z.number(),
  nullRatio: z.number(),
  level: z.enum(['low', 'medium', 'high']),
});

const ResultSchema = z.object({
  status: z.enum(['pass', 'warning', 'fail']),
  dataConfidence: z.number().min(0).max(1),
  rowCount: z.number(),
  availableDomains: z.array(z.string()),
  missingDomains: z.array(z.string()),
  fieldGaps: z.array(FieldGapSchema),
});

type Result = z.infer<typeof ResultSchema>;

export const dataHealthSkill: Skill<typeof InputSchema, Result> = {
  id: 'data-health',
  name: '数据健康检查',
  version: '1.0.0',
  description: '检查 period 范围内的数据可用性、行数、字段缺失率，输出 dataConfidence 给后续 Skill 使用',
  inputSchema: InputSchema,
  outputResultSchema: ResultSchema,
  deterministic: true,
  async run(input, ctx) {
    const { whereWithDate } = buildPeriodWhere(input.period, ctx);

    // 1. 域可用性
    const loaded = await listLoadedRelations();
    const missingDomains = input.requiredDomains.filter((d) => !loaded.includes(d));
    const hasPolicyFact = await relationExists('PolicyFact');

    // 若主表不存在，直接 fail
    if (!hasPolicyFact) {
      return {
        result: {
          status: 'fail',
          dataConfidence: 0,
          rowCount: 0,
          availableDomains: loaded,
          missingDomains,
          fieldGaps: [],
        },
        evidence: [{ source: 'information_schema.tables', note: 'PolicyFact 不存在' }],
        confidence: 1,
        warnings: ['核心数据表 PolicyFact 未加载，所有后续 Skill 将无法运行'],
        assumptions: [],
        dataLineage: ['information_schema.tables'],
        nextSuggestedSkills: [],
      };
    }

    // 2. 行数 + 字段缺失率
    const fieldExpressions = input.requiredFields
      .map((f) => `SUM(CASE WHEN ${f} IS NULL THEN 1 ELSE 0 END) AS null_${f}`)
      .join(', ');
    const sql = `
      SELECT COUNT(*) AS row_count, ${fieldExpressions}
      FROM PolicyFact
      WHERE ${whereWithDate}
    `;
    const rows = await runSql<Record<string, number | string>>(sql);
    const row = rows[0] ?? { row_count: 0 };
    const rowCount = Number(row.row_count ?? 0);

    const fieldGaps = input.requiredFields
      .map((f) => {
        const nullCount = Number(row[`null_${f}`] ?? 0);
        const nullRatio = rowCount > 0 ? nullCount / rowCount : 0;
        const level: 'low' | 'medium' | 'high' = nullRatio > 0.2 ? 'high' : nullRatio > 0.05 ? 'medium' : 'low';
        return { field: f, nullCount, nullRatio: Number(nullRatio.toFixed(4)), level };
      })
      .filter((g) => g.nullRatio > 0);

    // 3. 综合状态
    const warnings: string[] = [];
    let status: 'pass' | 'warning' | 'fail' = 'pass';
    let dataConfidence = 1.0;

    if (rowCount === 0) {
      status = 'fail';
      dataConfidence = 0;
      warnings.push(`period [${input.period.startDate} ~ ${input.period.endDate}] 内无数据`);
    } else if (rowCount < 50) {
      status = 'warning';
      dataConfidence = 0.5;
      warnings.push(`period 内仅 ${rowCount} 条记录，统计意义有限`);
    }

    const highGaps = fieldGaps.filter((g) => g.level === 'high');
    if (highGaps.length > 0) {
      status = status === 'fail' ? 'fail' : 'warning';
      dataConfidence = Math.min(dataConfidence, 0.7);
      warnings.push(
        `字段缺失率 > 20% 的字段：${highGaps.map((g) => `${g.field}(${(g.nullRatio * 100).toFixed(1)}%)`).join('、')}`
      );
    } else if (fieldGaps.some((g) => g.level === 'medium')) {
      dataConfidence = Math.min(dataConfidence, 0.85);
    }

    if (missingDomains.length > 0) {
      status = status === 'fail' ? 'fail' : 'warning';
      warnings.push(`数据域未加载：${missingDomains.join('、')}`);
    }

    return {
      result: {
        status,
        dataConfidence: Number(dataConfidence.toFixed(3)),
        rowCount,
        availableDomains: loaded,
        missingDomains,
        fieldGaps,
      },
      evidence: [
        { metric: 'row_count', value: rowCount, source: 'PolicyFact', note: '满足 period + 行级过滤' },
      ],
      confidence: 1.0,
      warnings,
      assumptions: [`日期字段使用 policy_date`, `行级过滤条件: ${ctx.permissionFilter}`],
      dataLineage: ['PolicyFact', 'information_schema.tables'],
      nextSuggestedSkills: status === 'fail' ? [] : ['kpi-baseline'],
    };
  },
};
