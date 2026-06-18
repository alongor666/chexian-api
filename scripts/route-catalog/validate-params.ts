/**
 * route-catalog 参数元数据 per-route 对账（governance 接线）
 *
 * 校验 query-routes-metadata.ts 登记的参数 vs route-param-contracts.ts 的运行时真实契约：
 *   1. 覆盖率：catalog 每条路由必须有契约条目（双向，多/缺都报错）
 *   2. 子集校验：catalog 登记的每个参数名 ⊆ 该路由契约的合法参数集合
 *      （catalog 是"重点提示"子集，允许少登记；登记了路由不接受的参数 = 提示误导，报错）
 *   3. enum 一致性：若 zod schema 声明了 enum，catalog 参数 enum 必须 ⊆ zod enum
 *      （catalog 公开值可以是 zod 内部接受值的子集——用于隐藏弃用别名；
 *      声明 zod 不接受的值 = 误导 agent 触发 400，报错）。
 *      若 zod 未声明 enum 但 catalog 登记了 enum：warning（提示无法机器校验，不阻断）。
 *
 * 运行：bun scripts/route-catalog/validate-params.ts
 * 退出码：0 通过 / 1 存在漂移
 */
import { QUERY_ROUTE_METADATA } from '../../server/src/config/query-routes-metadata.js';
import {
  ROUTE_PARAM_CONTRACTS,
  contractAllowedKeys,
  contractZodEnums,
} from '../../server/src/config/route-param-contracts.js';

let failed = false;
const fail = (msg: string) => {
  failed = true;
  console.error(`  ✗ ${msg}`);
};
const warnings: string[] = [];
const warn = (msg: string) => warnings.push(msg);

// ── 1. 覆盖率双向对账 ──────────────────────────────
const catalogPaths = new Set(QUERY_ROUTE_METADATA.map((r) => r.path));
const contractPaths = new Set(Object.keys(ROUTE_PARAM_CONTRACTS));

for (const p of catalogPaths) {
  if (!contractPaths.has(p)) fail(`catalog 路由缺少参数契约: ${p}（在 route-param-contracts.ts 登记）`);
}
for (const p of contractPaths) {
  if (!catalogPaths.has(p)) fail(`契约登记了 catalog 不存在的路由: ${p}（删除或先登记 catalog）`);
}

// ── 2. per-route 子集校验 + 3. enum 一致性 ──────────
let checkedParams = 0;
let checkedEnums = 0;
for (const route of QUERY_ROUTE_METADATA) {
  const contract = ROUTE_PARAM_CONTRACTS[route.path];
  if (!contract) continue; // 覆盖率检查已报

  const allowed = contractAllowedKeys(contract);
  const zodEnums = contractZodEnums(contract);
  for (const param of route.parameters) {
    checkedParams++;
    if (!allowed.has(param.name)) {
      fail(
        `${route.path} 登记了路由不接受的参数 '${param.name}'` +
        `（运行时会被静默忽略；合法参数见 route-param-contracts.ts 对应契约）`
      );
      continue;
    }
    if (!param.enum) continue; // catalog 没声明 enum，对账规则不适用

    const zodEnum = zodEnums.get(param.name);
    if (!zodEnum) {
      warn(
        `${route.path} 参数 '${param.name}' 在 catalog 声明了 enum=[${param.enum.join(',')}] ` +
        `但 zod schema 不是 ZodEnum → 无法机器校验，建议把 zod 改为 z.enum(...) 以闭合事实源`
      );
      continue;
    }
    checkedEnums++;
    const zodSet = new Set(zodEnum);
    const stray = param.enum.filter((v) => !zodSet.has(v));
    if (stray.length > 0) {
      fail(
        `${route.path} 参数 '${param.name}' 的 catalog enum 含 zod 不接受的值: [${stray.join(',')}]` +
        `（zod 合法集合: [${zodEnum.join(',')}]；调用方传这些值会被 zod 拒绝）`
      );
    }
  }
}

if (warnings.length > 0) {
  console.warn('\n  ⚠ 以下提示不阻断（建议处理）：');
  for (const w of warnings) console.warn(`    ${w}`);
}

if (failed) {
  console.error(
    '\n  修复指引：catalog 参数名必须与运行时 zod schema / 解析代码的字段名完全一致' +
    '（注意 camelCase，如 startDate 而非 start_date）；enum 必须是 zod enum 的子集。'
  );
  process.exit(1);
}

console.log(
  `✓ route-catalog 参数对账通过（${catalogPaths.size} 条路由契约全覆盖，` +
  `${checkedParams} 个登记参数全部属于运行时合法集合，${checkedEnums} 个 enum 与 zod 对齐` +
  `${warnings.length > 0 ? `，${warnings.length} 条 warning` : ''}）`
);
