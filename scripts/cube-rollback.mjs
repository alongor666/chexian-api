#!/usr/bin/env node
/**
 * 通用立方体灰度回滚器（AI agent 入口）
 *
 * AI agent 看到 mismatch 误报、想紧急回退立方体时跑这个脚本。
 * 不依赖任何 SOP 文档，所有可选动作就在 --help。
 *
 * 两道开关 + 两类动作：
 *   --target shadow     关 CUBE_SHADOW_COMPARE（停影子双跑；用户行为不变，因为本来就走原路径）
 *   --target routing    关 CUBE_ROUTING_ENABLED（已切流情境回退到原路径；这是真正的"业务回滚"）
 *   --target both       两个都关（彻底关闭立方体的所有外部行为；立方体表仍占内存但不被访问）
 *
 * 实际动作：远程 ssh 修改 /var/www/chexian/server/ecosystem.config.cjs 后 reload。
 * 必须有 deployer ssh 权限。
 *
 * 用法：
 *   node scripts/cube-rollback.mjs --target shadow                  # ssh + sed + reload，立刻生效
 *   node scripts/cube-rollback.mjs --target routing --dry-run       # 仅打印命令不执行
 *   node scripts/cube-rollback.mjs --target both --reason "B7 mismatch"
 *
 * 真彻底回滚（几乎不需要，立方体只是内存里的额外表）：
 *   revert PR #595/#600/#601/#602/#603/#604。但这里两道开关默认 'false' 已经等同从未存在。
 *
 * 相关：scripts/release/cube-promote.mjs（推进决策） · scripts/sentinel/cube-grayscale-sentinel.mjs（哨兵）
 */

import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const args = {
  target: null,
  dryRun: false,
  sshAlias: 'deployer@162.14.113.44',
  ecosystemPath: '/var/www/chexian/server/ecosystem.config.cjs',
  reason: '',
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const eat = () => argv[++i];
  if (a === '--target') args.target = eat();
  else if (a === '--dry-run') args.dryRun = true;
  else if (a === '--ssh-alias') args.sshAlias = eat();
  else if (a === '--ecosystem-path') args.ecosystemPath = eat();
  else if (a === '--reason') args.reason = eat();
  else if (a === '--help' || a === '-h') {
    console.error('见文件头注释；--target shadow|routing|both [--dry-run] [--reason "..."]');
    process.exit(0);
  }
}

if (!['shadow', 'routing', 'both'].includes(args.target)) {
  console.error('必须 --target shadow|routing|both');
  process.exit(2);
}

const switches = args.target === 'both'
  ? ['CUBE_SHADOW_COMPARE', 'CUBE_ROUTING_ENABLED']
  : args.target === 'shadow'
  ? ['CUBE_SHADOW_COMPARE']
  : ['CUBE_ROUTING_ENABLED'];

const sedExpr = switches.map((k) => `s/${k}: '\\''true'\\''/${k}: '\\''false'\\''/`).join(';');
const remote = [
  `sudo sed -i "${sedExpr}" ${args.ecosystemPath}`,
  `sudo /usr/local/bin/deploy-chexian-api reload`,
  `curl -s http://localhost:3000/health | head -c 200`,
].join(' && ');

const sshCmd = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', args.sshAlias, remote];

console.log(`[cube-rollback] target=${args.target}${args.reason ? ` reason="${args.reason}"` : ''}`);
console.log(`[cube-rollback] 将执行：ssh ${args.sshAlias} '${remote}'`);
if (args.dryRun) {
  console.log('[cube-rollback] --dry-run，不执行');
  process.exit(0);
}

try {
  const out = execFileSync('ssh', sshCmd, { encoding: 'utf-8', stdio: ['inherit', 'pipe', 'inherit'] });
  console.log(out);
  console.log('[cube-rollback] 完成。建议跑 scripts/release/cube-promote.mjs 二次确认状态。');
} catch (err) {
  console.error(`[cube-rollback] 失败：${err.message}`);
  process.exit(1);
}
