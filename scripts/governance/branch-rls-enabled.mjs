/**
 * 治理检查：多省 RLS 总闸 BRANCH_RLS_ENABLED 必须为 'true'（安全审查 M1）
 *
 * 背景：`BRANCH_RLS_ENABLED` 默认 'false'（fail-open 单租户）。山西(SX)账号已在生产激活
 * （2026-07-07 cutover），RLS 关闭时 permission.ts 完全跳过 branch_code 过滤 → 山西 branch_admin
 * 会看到四川数据（跨省串读）。此前该值只靠 ecosystem.config.cjs 人工正确 + 发布时 curl 核实，
 * 无 CI 断言；env 漂移 / 新部署环境漏设即静默回落单租户。本闸把「总闸必开」固化为 governance。
 *
 * 口径：只断言 ecosystem.config.cjs 的 env 块里 BRANCH_RLS_ENABLED === 'true'。
 *   - 复用 scripts/lib/ecosystem-parser.mjs 的 parseEcosystemEnvKeys（去注释 / 去引号 / 大括号
 *     深度匹配），不另写易误伤注释/重复块的单行正则。
 *   - 配置分层注意：JWT_SECRET / USER_PASSWORDS 走 server/.env（不进 git），不在 ecosystem 管辖，
 *     本闸不涉及；BRANCH_RLS_ENABLED 是 PM2 env 块管的功能开关，正是本闸对象。
 *
 * 调用方：scripts/check-governance.mjs（io 注入模式，与 self-service-password-isolation 同构）。
 */

import fs from 'fs';
import path from 'path';
import { parseEcosystemEnvKeys } from '../lib/ecosystem-parser.mjs';

const ECOSYSTEM_REL = 'server/ecosystem.config.cjs';

export function runBranchRlsEnabledCheck({ rootDir, io }) {
  const { info, success, error } = io;
  info('检查多省 RLS 总闸 BRANCH_RLS_ENABLED=true（安全审查 M1）...');

  const ecosystemPath = path.join(rootDir, ECOSYSTEM_REL);
  if (!fs.existsSync(ecosystemPath)) {
    error(`${ECOSYSTEM_REL} 不存在，无法核验 RLS 总闸（生产 PM2 env 契约缺失）`);
    return false;
  }

  const content = fs.readFileSync(ecosystemPath, 'utf-8');
  const { env } = parseEcosystemEnvKeys(content);
  const value = env.BRANCH_RLS_ENABLED;

  if (value === undefined) {
    error(`${ECOSYSTEM_REL} 的 env 块未声明 BRANCH_RLS_ENABLED（多省平台必须显式开启，禁止依赖默认值 'false'）`);
    error("  修复：在 env: { ... } 中加 BRANCH_RLS_ENABLED: 'true',");
    return false;
  }

  if (value !== 'true') {
    error(`${ECOSYSTEM_REL} 的 BRANCH_RLS_ENABLED='${value}'，必须为 'true'（否则山西/四川跨省数据串读）`);
    error('  多省已 cutover（SX 生产激活），RLS 关闭是 CRITICAL 跨租户泄漏。');
    error('  若确需临时回滚，走 .claude/rules/multi-branch-rollback-sop.md（人工事故响应），不改本闸。');
    return false;
  }

  success("多省 RLS 总闸 BRANCH_RLS_ENABLED='true'（跨省隔离生效）");
  return true;
}
