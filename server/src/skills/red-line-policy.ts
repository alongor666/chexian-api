/**
 * Red Line Policy — 阶段 2
 *
 * 当 Skill 输出涉及 CLAUDE.md §10 红线（业务字典未确认的口径、定价因果假设、
 * 核保动作建议等）时，由本模块在 runner 末尾强制注入 warning，无法被 Skill
 * 内部覆盖或遗漏。
 *
 * 设计原则：
 * - 唯一事实源：本文件即 RED_LINE_WARNINGS 字典；阶段 4 PR 必须更新
 *   开发文档/SKILL_RED_LINE_DRAFT.md，等业务确认后再迁移到业务规则字典
 * - 不修改 result，只追加 warnings；保留原有 warnings
 * - 去重：若 Skill 内部已显式声明，不重复追加
 * - Skill 未登记 → 不注入，避免静默污染未触红线的 Skill
 */

import type { SkillResult } from './types.js';

export const RED_LINE_WARNINGS: Readonly<Record<string, ReadonlyArray<string>>> = {
  'segment-risk-scan': [
    'credibility 修正基于统计学经验公式 n/(n+300)，未经业务字典确认，仅作分析参考',
  ],
  'risk-scoring': [
    '本评分基于规则模型，未经精算建模与业务字典确认',
  ],
  'pricing-simulation': [
    '未纳入客户流失弹性模型，保费影响可能偏乐观',
    'lossRatioAfter 假设客群结构不变，违反 CLAUDE.md §10 「定价系数 ≠ 赔付因果」',
    '本结果不构成定价建议，仅供分析参考',
  ],
  'underwriting-recommendation': [
    '本建议未经核保人工审核，禁止直接执行写入',
  ],
} as const;

/**
 * 在 SkillResult 上追加红线警告（去重，不可变更新）
 */
export function applyRedLinePolicy<R>(skillId: string, result: SkillResult<R>): SkillResult<R> {
  const extras = RED_LINE_WARNINGS[skillId];
  if (!extras || extras.length === 0) return result;

  const existing = new Set(result.warnings ?? []);
  const merged = [...(result.warnings ?? [])];
  for (const w of extras) {
    if (!existing.has(w)) {
      merged.push(w);
      existing.add(w);
    }
  }

  return { ...result, warnings: merged };
}

/** 仅供测试与文档生成使用 */
export function listRedLineSkillIds(): string[] {
  return Object.keys(RED_LINE_WARNINGS);
}
