/**
 * 受限模块后端覆盖对账的解析内核（2026-07-17 评审 P2 二轮加固）。
 *
 * 为什么独立成模块而不内联在测试里：
 *   1. 解析逻辑本身需要被"变异测试"证伪（注释同名守卫 / 第二文件新增入口），
 *      内联在契约测试里无法对合成源码做负向用例；
 *   2. 契约测试（restricted-module-backend-coverage.test.ts）与解析单测
 *      （restricted-module-coverage-parsing.test.ts）共用同一实现，杜绝两套正则漂移。
 *
 * 一轮实现的两个假绿缺口（评审 Finding 1）：
 *   - `block.includes(guardName)` 会被注释里的守卫名骗过（如
 *     `/* requireAccessControlModule deliberately omitted *​/`）→ 现在先剥注释再匹配，
 *     且要求守卫以「独立实参」形态出现（前邻 换行/括号/逗号，后随逗号）；
 *   - 声明只支持单 sourceFile，无法发现第二个文件里新增的同前缀入口 → 声明改
 *     sourceFiles 数组，契约测试另做全路由文件扫描（未声明文件出现同前缀路由即红）。
 */

export interface RouteBlock {
  method: string;
  path: string;
  block: string;
}

/**
 * 剥掉块注释与行注释。仅用于路由声明结构分析——不处理字符串字面量内的伪注释
 * （路由声明块中 path 之外的字符串极少含 `//`，误剥只会让匹配更严格，fail-closed 方向安全）。
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * 提取源码中的全部 router.<method>(...) 声明块（在剥注释后的源码上进行）。
 * 块的边界 = 当前 router.<method>( 到下一个 router.<method>(（或文件尾）；
 * 块内第一个引号字符串即路由 path（本仓路由声明的固定形态：path 是首个实参）。
 */
export function extractRouteBlocks(rawSource: string): RouteBlock[] {
  const source = stripComments(rawSource);
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

/**
 * 守卫是否以「真实中间件实参」形态挂在该路由声明块内：
 * 守卫名前邻 换行/开括号/逗号（即实参位置）、后随逗号。
 * block 已在 extractRouteBlocks 剥过注释，注释同名 / 字符串内提及均不满足此形态。
 */
export function isRouteGuarded(block: string, guardName: string): boolean {
  return new RegExp(`(^|[\\n(,])\\s*${guardName}\\s*,`).test(block);
}

/** 路由 path 是否命中前缀集合（精确等于前缀、或以 `${前缀}/` 开头） */
export function matchesPrefix(routePath: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => routePath === p || routePath.startsWith(`${p}/`));
}
