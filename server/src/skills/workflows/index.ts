/**
 * Workflow Registry — 阶段 2
 *
 * 集中注册所有 WorkflowDef，被 routes/workflows.ts 查询。
 */

import type { WorkflowDef } from '../workflow-runner.js';
import { autoRiskControlWorkflow } from './auto-risk-control.workflow.js';

const ALL_WORKFLOWS: ReadonlyArray<WorkflowDef<any>> = [autoRiskControlWorkflow];

const WORKFLOW_MAP = new Map<string, WorkflowDef<any>>(ALL_WORKFLOWS.map((w) => [w.id, w]));

if (WORKFLOW_MAP.size !== ALL_WORKFLOWS.length) {
  const ids = ALL_WORKFLOWS.map((w) => w.id);
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) dupes.push(id);
    seen.add(id);
  }
  throw new Error(`[WorkflowRegistry] Duplicate workflow IDs: ${dupes.join(', ')}`);
}

export function getWorkflow(id: string): WorkflowDef<any> | undefined {
  return WORKFLOW_MAP.get(id);
}

export function listWorkflows(): ReadonlyArray<{
  id: string;
  name: string;
  version: string;
  description: string;
  nodeCount: number;
}> {
  return ALL_WORKFLOWS.map((w) => ({
    id: w.id,
    name: w.name,
    version: w.version,
    description: w.description,
    nodeCount: w.nodes.length,
  }));
}

export { ALL_WORKFLOWS };
