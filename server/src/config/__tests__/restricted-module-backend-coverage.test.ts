/**
 * 受限模块后端入口覆盖对账（静态契约测试，2026-07-17 评审 P2 收口；二轮加固防假绿）
 *
 * 背景：RESTRICTED_MODULES（模块负面清单）的通用运行时强制点只覆盖 governed 域
 * （目前仅 /api/query，见 permission.ts MOUNT_WHITELIST_POLICY），因此"把页面加进
 * 负面清单"只保证前端隐藏与查询域拦截，并不天然封死该模块在其他挂载域的后端 API。
 *
 * 不变量：
 *   1. RESTRICTED_MODULES 每个受限页面必须在 RESTRICTED_MODULE_BACKEND_GUARDS
 *      声明后端入口覆盖（sourceFiles + routePrefixes + guardName）；反向无死条目。
 *   2. 声明文件内所有路径命中 routePrefixes 的路由声明必须以**真实实参形态**挂
 *      guardName（注释/字符串里提及不算——解析内核剥注释 + 实参位形态匹配，
 *      见 restricted-module-coverage.ts；合成源码变异用例见
 *      restricted-module-coverage-parsing.test.ts）。
 *   3. server/src/routes/ 下**未声明**的路由文件出现同前缀路由 → 红
 *      （防"第二个文件新增入口"绕过覆盖声明）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RESTRICTED_MODULES,
  RESTRICTED_MODULE_BACKEND_GUARDS,
} from '../preset-users.js';
import {
  extractRouteBlocks,
  isRouteGuarded,
  matchesPrefix,
} from '../restricted-module-coverage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = resolve(__dirname, '../..');
const ROUTES_DIR = join(SERVER_SRC, 'routes');

/** 递归列出 server/src/routes 下全部 .ts 路由源文件（排除测试） */
function listRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') out.push(...listRouteFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
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
    describe(`受限模块 ${pagePath} → [${guard.sourceFiles.join(', ')}]`, () => {
      const declaredAbs = guard.sourceFiles.map((f) => join(SERVER_SRC, f));
      const coveredPerFile = declaredAbs.map((file) => ({
        file,
        blocks: extractRouteBlocks(readFileSync(file, 'utf-8')).filter((b) =>
          matchesPrefix(b.path, guard.routePrefixes),
        ),
      }));
      const covered = coveredPerFile.flatMap((f) => f.blocks);

      it('守卫中间件在每个声明文件中真实定义/引入（防声明名漂移）', () => {
        for (const file of declaredAbs) {
          const source = readFileSync(file, 'utf-8');
          expect(
            new RegExp(
              `(function\\s+${guard.guardName}\\b|\\b${guard.guardName}\\b[^\\n]*from)`,
            ).test(source),
            `${relative(SERVER_SRC, file)} 中找不到守卫 ${guard.guardName} 的定义或 import`,
          ).toBe(true);
        }
      });

      it('routePrefixes 至少命中 1 条路由声明（解析器自检，防正则静默失配）', () => {
        expect(covered.length).toBeGreaterThan(0);
      });

      it('命中前缀的每条路由声明都以真实实参形态挂守卫（注释同名不算，fail-closed）', () => {
        const unguarded = covered
          .filter((b) => !isRouteGuarded(b.block, guard.guardName))
          .map((b) => `${b.method.toUpperCase()} ${b.path}`);
        expect(
          unguarded,
          `以下路由属于受限模块 ${pagePath} 但未挂 ${guard.guardName}（白名单外用户可直连）：${unguarded.join(
            ', ',
          )}`,
        ).toEqual([]);
      });

      it('未声明的路由文件不得出现同前缀路由（防第二文件新增入口绕过覆盖声明）', () => {
        const declaredSet = new Set(declaredAbs);
        const offenders: string[] = [];
        for (const file of listRouteFiles(ROUTES_DIR)) {
          if (declaredSet.has(file)) continue;
          const hits = extractRouteBlocks(readFileSync(file, 'utf-8')).filter((b) =>
            matchesPrefix(b.path, guard.routePrefixes),
          );
          for (const h of hits) {
            offenders.push(`${relative(SERVER_SRC, file)}: ${h.method.toUpperCase()} ${h.path}`);
          }
        }
        expect(
          offenders,
          `以下路由与受限模块 ${pagePath} 的前缀（${guard.routePrefixes.join(
            ', ',
          )}）同形，但所在文件未在 sourceFiles 声明：${offenders.join(
            '; ',
          )}——若属该模块请加入 sourceFiles 并挂守卫；若是无关同名路由请改前缀/路径避免歧义`,
        ).toEqual([]);
      });
    });
  }
});
