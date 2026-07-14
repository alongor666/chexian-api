/**
 * 治理检查：org_user 默认可见路由前后端清单一致
 *
 * 后端权威 SSOT = server/src/config/preset-users.ts 的 ORG_ROLE_ALLOWED_ROUTES（org_user
 * 角色默认 allowedRoutes）。前端 src/shared/config/organizations.ts 的
 * ORG_USER_DEFAULT_ALLOWED_ROUTES 是「后端未下发 allowedRoutes 时」的本地兜底清单。
 *
 * 两清单必须集合相等：前端多出的路由会在后端 allowedRoutes 为空（如新接入飞书部门账号）
 * 时被前端放行，页面挂载后发起的查询请求被后端按权威清单拦截 → 403。顺序不敏感，用 Set 比较。
 *
 * 调用方：scripts/check-governance.mjs（io 注入模式，与 self-service / dual-lock 检查同构）。
 */

import fs from 'fs';
import path from 'path';

function extractRoutes(filePath, arrayName) {
  if (!fs.existsSync(filePath)) return null;
  // 先去掉行内 // 注释，防止数组内联注释里出现的 `]` 提前截断非贪婪匹配
  // （已知局限：假定路由数组字面量本身不含 `//` 子串，与当前两处清单实际情况相符）。
  const content = fs.readFileSync(filePath, 'utf-8').replace(/\/\/.*$/gm, '');
  // 匹配 `export const <arrayName>[: 类型] = [ ... ];` 的数组字面量
  const m = content.match(new RegExp(`${arrayName}\\s*(?::[^=]+)?=\\s*\\[([\\s\\S]*?)\\]`));
  if (!m) return null;
  return new Set([...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]));
}

export function runOrgUserAllowedRoutesConsistencyCheck({ rootDir, io }) {
  const { info, success, error } = io;
  info('检查 org_user 默认可见路由前后端清单一致（后端权威 ⟷ 前端本地兜底）...');

  const backPath = path.join(rootDir, 'server/src/config/preset-users.ts');
  const frontPath = path.join(rootDir, 'src/shared/config/organizations.ts');

  const back = extractRoutes(backPath, 'ORG_ROLE_ALLOWED_ROUTES');
  const front = extractRoutes(frontPath, 'ORG_USER_DEFAULT_ALLOWED_ROUTES');

  if (back === null || front === null) {
    error('无法解析 org_user 默认路由清单（后端 ORG_ROLE_ALLOWED_ROUTES / 前端 ORG_USER_DEFAULT_ALLOWED_ROUTES）');
    console.log(`    后端: ${backPath}`);
    console.log(`    前端: ${frontPath}`);
    return false;
  }

  const onlyBack = [...back].filter((r) => !front.has(r));
  const onlyFront = [...front].filter((r) => !back.has(r));
  if (onlyBack.length > 0 || onlyFront.length > 0) {
    error('前后端 org_user 默认可见路由清单不一致（前端兜底会在后端 allowedRoutes 为空时放行多余页面 → 403）');
    if (onlyBack.length > 0) console.log(`    仅后端有: [${onlyBack.join(', ')}]`);
    if (onlyFront.length > 0) console.log(`    仅前端有: [${onlyFront.join(', ')}]`);
    console.log(`    修复：使两清单集合一致 —— ${backPath} 与 ${frontPath}`);
    return false;
  }

  success(`org_user 默认路由前后端一致（${[...back].join('/')}）`);
  return true;
}
