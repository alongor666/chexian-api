/**
 * 治理检查：「仅限自助设密」账号永不进 USER_PASSWORDS（全员密码闭环 · 2026-07-11）
 *
 * 名单 SSOT = server/src/config/preset-users.ts 的 SELF_SERVICE_PASSWORD_ONLY_USERS。
 * 这些账号的密码只能由本人经激活令牌 / 飞书首登强制设密链路自设；共享初始密码经 env
 * 注入即违反设计（auth.ts resolveEffectiveHash 运行时也会忽略，本检查是静态第二道闸）。
 *
 * 检查两处：
 *   1) 本地 env 文件（server/.env / .env，gitignored，存在才查）USER_PASSWORDS JSON 键；
 *   2) git 跟踪文件中「USER_PASSWORDS 与名单用户名同行共现」的行（部署脚本/CI 误写拦截）。
 *      排除测试目录——单测需要模拟「误注入被运行时忽略」的合法反例。
 *
 * 调用方：scripts/check-governance.mjs（io 注入模式，与 dual-lock 检查同构）。
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export function runSelfServicePasswordIsolationCheck({ rootDir, io }) {
  const { info, success, error } = io;
  info('检查自助设密账号禁入 USER_PASSWORDS（全员密码闭环）...');

  const presetPath = path.join(rootDir, 'server/src/config/preset-users.ts');
  const presetSrc = fs.readFileSync(presetPath, 'utf-8');
  const listMatch = presetSrc.match(/SELF_SERVICE_PASSWORD_ONLY_USERS\s*:[^=]*=\s*\[([\s\S]*?)\]/);
  if (!listMatch) {
    error('preset-users.ts 缺少 SELF_SERVICE_PASSWORD_ONLY_USERS 名单（自助设密运行时兜底依赖它）');
    return false;
  }
  const usernames = [...listMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (usernames.length === 0) {
    success('自助设密名单为空，无需检查');
    return true;
  }

  const problems = [];

  // 1) 本地 env 文件的 USER_PASSWORDS 键
  for (const envRel of ['server/.env', '.env']) {
    const envPath = path.join(rootDir, envRel);
    if (!fs.existsSync(envPath)) continue;
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      if (!line.includes('USER_PASSWORDS')) continue;
      for (const u of usernames) {
        if (new RegExp(`["']${u}["']\\s*:`).test(line)) {
          problems.push(`${envRel}: USER_PASSWORDS 含自助设密账号 ${u}`);
        }
      }
    }
  }

  // 2) git 跟踪文件中同行共现。排除：本模块、名单定义文件、测试（单测需模拟「误注入被
  //    运行时忽略」的合法反例）、backlog 事件账本与自进化日志（治理记录会引用闸名与账号名，
  //    不是注入渠道）。
  let grepOut = '';
  try {
    grepOut = execSync(
      "git grep -In 'USER_PASSWORDS' -- . ':!scripts/governance/self-service-password-isolation.mjs' ':!server/src/config/preset-users.ts' ':!**/__tests__/**' ':!tests/**' ':!backlog-events/**' ':!BACKLOG_LOG.jsonl' ':!.claude/workflow/**'",
      { cwd: rootDir, encoding: 'utf-8' },
    );
  } catch {
    grepOut = ''; // git grep 无匹配退出码 1
  }
  for (const line of grepOut.split('\n')) {
    if (!line) continue;
    for (const u of usernames) {
      if (line.includes(u)) {
        problems.push(`跟踪文件同行共现 USER_PASSWORDS 与 ${u}：${line.slice(0, 160)}`);
      }
    }
  }

  if (problems.length > 0) {
    error('自助设密账号出现在 USER_PASSWORDS 上下文（这些账号密码只能本人自设，禁止 env 注入）：');
    for (const p of problems) console.log(`    - ${p}`);
    return false;
  }
  success(`自助设密账号（${usernames.length} 个）未出现在 USER_PASSWORDS 上下文`);
  return true;
}
