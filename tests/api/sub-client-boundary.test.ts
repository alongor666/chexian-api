/**
 * 命名空间子客户端架构边界守卫（持久护栏）
 *
 * 神类拆分的全部价值 = 可维护性持久。若无机器可执行的护栏，半年后必有人给某个
 * *-api.ts 注入 token 写入、或 new 第二个传输内核，把拆分悄悄拆回去。
 *
 * 不变量（源码静态断言，零运行成本）：
 *  1. 子客户端只能通过**只读** ApiTransport 句柄发请求 → 禁止 import 单例 client、
 *     禁止 new ApiClientCore/ApiClient、禁止调用 token 写方法。
 *  2. ApiTransport 必须**类型导入**（type-only），不得作为值引入（值里没有写方法，但
 *     类型导入从形态上杜绝拿到可写实例）。
 *  3. 从 client-core 的**值导入**仅允许白名单（API_BASE，供 data 域 multipart upload）。
 *  4. meta 守卫：守卫清单必须覆盖 src/shared/api 下每个 *-api.ts，杜绝"新增子客户端漏挂护栏"。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API_DIR = fileURLToPath(new URL('../../src/shared/api/', import.meta.url));

/** 与 scripts/check-hotfile-contracts.mjs:API_SUBCLIENTS 保持一致 */
const SUBCLIENTS = [
  'ai-api', 'auth-api', 'claims-detail-api', 'cross-sell-api', 'customer-flow-api',
  'data-api', 'performance-api', 'quote-conversion-api', 'repair-api', 'workflows-api',
];

/** 仅允许从 client-core 值导入的符号（非类型） */
const CLIENT_CORE_VALUE_IMPORT_ALLOWLIST = new Set(['API_BASE']);

function loadSource(name: string): string {
  return readFileSync(`${API_DIR}${name}.ts`, 'utf8');
}
/** 去注释，避免边界说明性注释（如 auth-api 解释"为何不迁 setToken"）误伤断言 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('命名空间子客户端架构边界', () => {
  it('守卫清单覆盖每个 *-api.ts（meta：新增子客户端不会漏挂护栏）', () => {
    const actual = readdirSync(API_DIR)
      .filter((f) => f.endsWith('-api.ts'))
      .map((f) => f.replace(/\.ts$/, ''))
      .sort();
    expect(actual).toEqual([...SUBCLIENTS].sort());
  });

  describe.each(SUBCLIENTS)('%s', (name) => {
    const code = stripComments(loadSource(name));

    it('不 new 第二个传输内核', () => {
      expect(code).not.toMatch(/new\s+ApiClientCore\b/);
      expect(code).not.toMatch(/new\s+ApiClient\b/);
    });

    it('不调用 token 写方法（setToken / clearToken / setSessionCookieHint）', () => {
      expect(code).not.toMatch(/\.setToken\s*\(/);
      expect(code).not.toMatch(/\.clearToken\s*\(/);
      expect(code).not.toMatch(/\.setSessionCookieHint\s*\(/);
    });

    it('不 import 单例 client（防绕过只读句柄拿到 apiClient.setToken）', () => {
      expect(code).not.toMatch(/from\s+['"]\.\/client['"]/);
    });

    it('ApiTransport 为类型导入', () => {
      const typeOnly = /import\s+type\s*\{[^}]*\bApiTransport\b/.test(code);
      const inlineType = /import\s*\{[^}]*\btype\s+ApiTransport\b/.test(code);
      expect(typeOnly || inlineType).toBe(true);
    });

    it('从 client-core 的值导入在白名单内（仅 API_BASE）', () => {
      // 匹配非 type-only 的 `import { ... } from './client-core'`
      const m = code.match(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/client-core['"]/);
      if (!m) return; // 仅类型导入或无导入 → 通过
      const valueNames = m[1]
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith('type ')); // 去掉内联 type 导入
      for (const n of valueNames) {
        expect(CLIENT_CORE_VALUE_IMPORT_ALLOWLIST.has(n)).toBe(true);
      }
    });
  });
});
