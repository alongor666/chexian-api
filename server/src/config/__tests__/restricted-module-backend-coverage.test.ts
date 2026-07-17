/**
 * 受限模块后端入口覆盖对账（静态契约测试，2026-07-17 评审 P2 收口）
 *
 * 背景：RESTRICTED_MODULES（模块负面清单）的通用运行时强制点只覆盖 governed 域
 * （目前仅 /api/query，见 permission.ts MOUNT_WHITELIST_POLICY），因此"把页面加进
 * 负面清单"只保证前端隐藏与查询域拦截，并不天然封死该模块在其他挂载域的后端 API。
 *
 * 不变量：
 *   1. RESTRICTED_MODULES 每个受限页面必须在 RESTRICTED_MODULE_BACKEND_GUARDS
 *      声明后端入口覆盖（sourceFile + routePrefixes + guardName）；反向无死条目。
 *   2. 声明的 sourceFile 内，所有路径命中 routePrefixes 的 router.<method> 路由声明
 *      都必须在同一声明块中挂 guardName 守卫中间件（fail-closed）。
 *
 * 只加负面清单不声明后端覆盖、或某条命中路由漏挂守卫 → 本测试红，而不是生产裸奔。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RESTRICTED_MODULES,
  RESTRICTED_MODULE_BACKEND_GUARDS,
} from '../preset-users.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = resolve(__dirname, '../..');

interface RouteBlock {
  method: string;
  path: string;
  block: string;
}

/**
 * 提取路由源码中的全部 router.<method>(...) 声明块。
 * 块的边界 = 当前 router.<method>( 到下一个 router.<method>(（或文件尾）；
 * 块内第一个引号字符串即路由 path（本仓路由声明的固定形态：path 是首个实参）。
 */
function extractRouteBlocks(source: string): RouteBlock[] {
  const starts: Array<{ index: number; method: string }> = [];
  const re = /router\.(get|post|put|delete|patch)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    starts.push({ index: m.index, method: m[1] });
  }
  const blocks: RouteBlock[] = [];
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].index : source.length;
    const block = source.slice(starts[i].index, end);
    const pathMatch = block.match(/['"`]([^'"`]+)['"`]/);
    if (pathMatch) {
      blocks.push({ method: starts[i].method, path: pathMatch[1], block });
    }
  }
  return blocks;
}

function matchesPrefix(routePath: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => routePath === p || routePath.startsWith(`${p}/`));
}

describe('RESTRICTED_MODULES 与后端入口覆盖声明对账', () => {
  it('每个受限页面都声明了后端覆盖（只加负面清单不声明后端 → 此处红）', () => {
    const undeclared = Object.keys(RESTRICTED_MODULES).filter(
      (pagePath) => !(pagePath in RESTRICTED_MODULE_BACKEND_GUARDS),
    );
    expect(
      undeclared,
      `以下受限页面未在 RESTRICTED_MODULE_BACKEND_GUARDS 声明后端入口覆盖（页面会隐藏但 API 可能仍可直连）：${undeclared.join(
        ', ',
      )}——请在 server/src/config/preset-users.ts 补充声明并给对应路由挂守卫中间件`,
    ).toEqual([]);
  });

  it('后端覆盖声明无死条目（每个键都对应真实受限页面）', () => {
    const stale = Object.keys(RESTRICTED_MODULE_BACKEND_GUARDS).filter(
      (pagePath) => !(pagePath in RESTRICTED_MODULES),
    );
    expect(
      stale,
      `以下后端覆盖声明找不到对应的 RESTRICTED_MODULES 条目（受限模块被移除后声明未同步）：${stale.join(', ')}`,
    ).toEqual([]);
  });

  for (const [pagePath, guard] of Object.entries(RESTRICTED_MODULE_BACKEND_GUARDS)) {
    describe(`受限模块 ${pagePath} → ${guard.sourceFile}`, () => {
      const source = readFileSync(join(SERVER_SRC, guard.sourceFile), 'utf-8');
      const blocks = extractRouteBlocks(source);
      const covered = blocks.filter((b) => matchesPrefix(b.path, guard.routePrefixes));

      it('守卫中间件在源文件中真实定义/引入（防声明名漂移）', () => {
        expect(
          new RegExp(`(function\\s+${guard.guardName}\\b|\\b${guard.guardName}\\b[^\\n]*from)`).test(
            source,
          ),
          `${guard.sourceFile} 中找不到守卫 ${guard.guardName} 的定义或 import`,
        ).toBe(true);
      });

      it('routePrefixes 至少命中 1 条路由声明（解析器自检，防正则静默失配）', () => {
        expect(covered.length).toBeGreaterThan(0);
      });

      it('命中前缀的每条路由声明都挂了守卫中间件（fail-closed）', () => {
        const unguarded = covered
          .filter((b) => !b.block.includes(guard.guardName))
          .map((b) => `${b.method.toUpperCase()} ${b.path}`);
        expect(
          unguarded,
          `以下路由属于受限模块 ${pagePath} 但未挂 ${guard.guardName}（白名单外用户可直连）：${unguarded.join(
            ', ',
          )}`,
        ).toEqual([]);
      });
    });
  }
});
