/**
 * Skill Registry — 阶段 1
 *
 * 集中注册所有可执行 Skill。新增 Skill 时在此追加。
 * 与 server/src/config/capability-registry.ts 的"前端入口"是不同概念：
 * - capability-registry: 用户在 UI 上能看到什么入口
 * - skill-registry: 后端能执行什么单一能力（被 workflow / route 调用）
 */

import type { Skill } from './types.js';
import { dataHealthSkill } from './skills/data-health.skill.js';
import { kpiBaselineSkill } from './skills/kpi-baseline.skill.js';
import { costDiagnosisSkill } from './skills/cost-diagnosis.skill.js';
import { claimsDrilldownSkill } from './skills/claims-drilldown.skill.js';
import { segmentRiskScanSkill } from './skills/segment-risk-scan.skill.js';
import { reportTemplateSkill } from './skills/report-template.skill.js';
import { riskScoringSkill } from './skills/risk-scoring.skill.js';
import { pricingSimulationSkill } from './skills/pricing-simulation.skill.js';
import { attachNarrativeSkill } from './skills/attach-narrative.skill.js';

const ALL_SKILLS: ReadonlyArray<Skill<any, any>> = [
  dataHealthSkill,
  kpiBaselineSkill,
  costDiagnosisSkill,
  claimsDrilldownSkill,
  segmentRiskScanSkill,
  reportTemplateSkill,
  riskScoringSkill,
  pricingSimulationSkill,
  attachNarrativeSkill,
];

const SKILL_MAP = new Map<string, Skill<any, any>>(ALL_SKILLS.map((s) => [s.id, s]));

if (SKILL_MAP.size !== ALL_SKILLS.length) {
  const ids = ALL_SKILLS.map((s) => s.id);
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) dupes.push(id);
    seen.add(id);
  }
  throw new Error(`[SkillRegistry] Duplicate skill IDs: ${dupes.join(', ')}`);
}

export function getSkill(id: string): Skill<any, any> | undefined {
  return SKILL_MAP.get(id);
}

export function listSkills(): ReadonlyArray<{
  id: string;
  name: string;
  version: string;
  description: string;
  deterministic: boolean;
  requiresApproval: boolean;
  requiredPermissions?: string[];
}> {
  return ALL_SKILLS.map((s) => ({
    id: s.id,
    name: s.name,
    version: s.version,
    description: s.description,
    deterministic: s.deterministic,
    requiresApproval: s.requiresApproval ?? false,
    requiredPermissions: s.requiredPermissions,
  }));
}

export { ALL_SKILLS };
