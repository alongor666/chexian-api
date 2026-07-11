/**
 * 挂载域纳管声明对账（静态测试，backlog de1e40）
 *
 * 不变量：app.ts 中每个挂载了 permissionMiddleware 的域，必须在
 * MOUNT_WHITELIST_POLICY 中显式声明是否纳入页面白名单（governed）；
 * 反向：注册表中的每个键必须对应 app.ts 真实挂载点（防漂移死条目）。
 *
 * 这是"未登记域运行时 fail-open 豁免"的配套 CI 闸——运行时不 403 误伤
 * （242c07 教训），声明缺失在这里变红，而不是在生产环境。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOUNT_WHITELIST_POLICY } from '../permission.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = resolve(__dirname, '../..');

/** 从 app.ts 提取 挂载点 → 路由模块文件路径（.ts） */
function collectMounts(): Array<{ mount: string; file: string }> {
  const appSource = readFileSync(join(SERVER_SRC, 'app.ts'), 'utf-8');

  // import xxxRoutes from './routes/xxx.js'（含 `import dataRoutes, { ... } from ...` 形态）
  const importMap = new Map<string, string>();
  for (const m of appSource.matchAll(
    /^import\s+(\w+)(?:\s*,\s*\{[^}]*\})?\s+from\s+'(\.\/[^']+)\.js';/gm
  )) {
    importMap.set(m[1], join(SERVER_SRC, `${m[2]}.ts`));
  }

  // app.use('/api/xxx', xxxRoutes)
  const mounts: Array<{ mount: string; file: string }> = [];
  for (const m of appSource.matchAll(/app\.use\('([^']+)',\s*(\w+)\)/g)) {
    const file = importMap.get(m[2]);
    if (file) mounts.push({ mount: m[1], file });
  }
  return mounts;
}

/** 路由模块是否真实引入 permissionMiddleware（import 行判定；纯注释提及不算） */
function usesPermissionMiddleware(file: string): boolean {
  const source = readFileSync(file, 'utf-8');
  return /^import\s*\{[^}]*\bpermissionMiddleware\b[^}]*\}\s*from/m.test(source);
}

describe('MOUNT_WHITELIST_POLICY 与 app.ts 挂载点对账', () => {
  const mounts = collectMounts();
  const governedMounts = mounts.filter((m) => usesPermissionMiddleware(m.file));

  it('app.ts 至少发现 1 个挂载 permissionMiddleware 的域（解析器自检，防正则静默失配）', () => {
    expect(mounts.length).toBeGreaterThan(5);
    expect(governedMounts.map((m) => m.mount)).toContain('/api/query');
  });

  it('每个挂载 permissionMiddleware 的域都在 MOUNT_WHITELIST_POLICY 显式声明', () => {
    const undeclared = governedMounts
      .map((m) => m.mount)
      .filter((mount) => !(mount in MOUNT_WHITELIST_POLICY));
    expect(
      undeclared,
      `以下挂载域使用了 permissionMiddleware 但未在 MOUNT_WHITELIST_POLICY 登记（fail-open 豁免会静默生效）：${undeclared.join(', ')}——请在 server/src/middleware/permission.ts 显式声明 governed 与 reason`
    ).toEqual([]);
  });

  it('MOUNT_WHITELIST_POLICY 无死条目（每个键对应 app.ts 真实挂载点且该域确实挂了 permissionMiddleware）', () => {
    const liveMounts = new Set(governedMounts.map((m) => m.mount));
    const stale = Object.keys(MOUNT_WHITELIST_POLICY).filter((key) => !liveMounts.has(key));
    expect(
      stale,
      `以下注册表条目在 app.ts 找不到对应的 permissionMiddleware 挂载点（挂载被移除/改名后注册表未同步）：${stale.join(', ')}`
    ).toEqual([]);
  });

  it('豁免域必须携带非空 reason（业务依据可追溯）', () => {
    for (const [mount, policy] of Object.entries(MOUNT_WHITELIST_POLICY)) {
      if (!policy.governed) {
        expect(policy.reason.trim().length, `${mount} 的豁免 reason 不能为空`).toBeGreaterThan(0);
      }
    }
  });
});
