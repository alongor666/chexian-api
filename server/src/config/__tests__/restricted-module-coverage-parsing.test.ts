/**
 * 受限模块覆盖解析内核的变异（负向）测试——评审 Finding 1 点名的两类假绿必须在此红过：
 *   1. 「注释同名」：守卫名只出现在注释里（块注释/行注释/字符串）→ 必须判为未守卫；
 *   2. 「第二文件新增入口」：另一份源码出现同前缀路由 → 解析器必须能发现
 *      （契约测试据此对未声明文件做全量扫描）。
 * 正向用例同步锁定真实声明形态，防加固过度误伤。
 */
import { describe, it, expect } from 'vitest';
import {
  extractRouteBlocks,
  isRouteGuarded,
  matchesPrefix,
  stripComments,
} from '../restricted-module-coverage.js';

const GUARD = 'requireAccessControlModule';

function makeRoute(body: string): string {
  return `router.get(\n${body}\n  asyncHandler(async (req, res) => { res.json({ ok: true }); })\n);\n`;
}

describe('isRouteGuarded：守卫必须是真实实参，注释/字符串提及不算', () => {
  it('正向：标准声明形态（authMiddleware → requireRole → 守卫）→ 判为已守卫', () => {
    const block = makeRoute(
      `  '/users',\n  authMiddleware,\n  requireRole(UserRole.BRANCH_ADMIN),\n  ${GUARD},`,
    );
    const [route] = extractRouteBlocks(block);
    expect(route.path).toBe('/users');
    expect(isRouteGuarded(route.block, GUARD)).toBe(true);
  });

  it('变异·块注释同名（评审给出的原型）→ 判为未守卫', () => {
    const block = makeRoute(
      `  '/users/export',\n  authMiddleware,\n  /* ${GUARD} deliberately omitted */`,
    );
    const [route] = extractRouteBlocks(block);
    expect(route.path).toBe('/users/export');
    expect(isRouteGuarded(route.block, GUARD)).toBe(false);
  });

  it('变异·行注释同名（含伪装成实参形态的 "// requireAccessControlModule,"）→ 判为未守卫', () => {
    const block = makeRoute(
      `  '/users/export',\n  authMiddleware,\n  // ${GUARD},`,
    );
    const [route] = extractRouteBlocks(block);
    expect(isRouteGuarded(route.block, GUARD)).toBe(false);
  });

  it('变异·字符串字面量提及守卫名 → 判为未守卫', () => {
    const block = makeRoute(
      `  '/users/export',\n  authMiddleware,\n  logStep('${GUARD}, skipped'),`,
    );
    const [route] = extractRouteBlocks(block);
    expect(isRouteGuarded(route.block, GUARD)).toBe(false);
  });

  it('变异·仅裸挂 authMiddleware（一轮实现会被 includes 骗过的场景之外的朴素漏挂）→ 判为未守卫', () => {
    const block = makeRoute(`  '/roles',\n  authMiddleware,`);
    const [route] = extractRouteBlocks(block);
    expect(isRouteGuarded(route.block, GUARD)).toBe(false);
  });
});

describe('extractRouteBlocks + matchesPrefix：第二文件新增入口可被发现', () => {
  it('另一份源码出现 /users 前缀路由 → 提取并命中前缀（契约测试据此让未声明文件变红）', () => {
    const secondFile = [
      `import { Router } from 'express';`,
      `const router = Router();`,
      makeRoute(`  '/users/bulk-export',\n  authMiddleware,`),
      makeRoute(`  '/health',\n  authMiddleware,`),
    ].join('\n');
    const hits = extractRouteBlocks(secondFile).filter((b) =>
      matchesPrefix(b.path, ['/users', '/roles']),
    );
    expect(hits.map((b) => `${b.method} ${b.path}`)).toEqual(['get /users/bulk-export']);
  });

  it('前缀匹配是段边界而非裸 startsWith：/users-report 不命中 /users', () => {
    expect(matchesPrefix('/users-report', ['/users'])).toBe(false);
    expect(matchesPrefix('/users', ['/users'])).toBe(true);
    expect(matchesPrefix('/users/:id/reset-token', ['/users'])).toBe(true);
  });

  it('注释里的伪路由声明不产生路由块', () => {
    const source = `// router.get('/users/ghost', handler)\n${makeRoute(`  '/roles',\n  authMiddleware,\n  ${GUARD},`)}`;
    const blocks = extractRouteBlocks(source);
    expect(blocks.map((b) => b.path)).toEqual(['/roles']);
  });
});

describe('stripComments：注释剥离本身的边界', () => {
  it('块注释跨多行剥净；行注释剥到行尾为止', () => {
    const out = stripComments(`a /* x\n y */ b // tail\nc`);
    expect(out).toBe('a  b \nc');
  });
});
