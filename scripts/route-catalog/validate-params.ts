/**
 * route-catalog 参数元数据 per-route 对账（governance 接线）
 *
 * 校验 query-routes-metadata.ts 登记的参数 vs route-param-contracts.ts 的运行时真实契约：
 *   1. 覆盖率：catalog 每条路由必须有契约条目（双向，多/缺都报错）
 *   2. 子集校验：catalog 登记的每个参数名 ⊆ 该路由契约的合法参数集合
 *      （catalog 是"重点提示"子集，允许少登记；登记了路由不接受的参数 = 提示误导，报错）
 *
 * 运行：bun scripts/route-catalog/validate-params.ts
 * 退出码：0 通过 / 1 存在漂移
 */
import { QUERY_ROUTE_METADATA } from '../../server/src/config/query-routes-metadata.js';
import {
  ROUTE_PARAM_CONTRACTS,
  contractAllowedKeys,
} from '../../server/src/config/route-param-contracts.js';

let failed = false;
const fail = (msg: string) => {
  failed = true;
  console.error(`  ✗ ${msg}`);
};

// ── 1. 覆盖率双向对账 ──────────────────────────────
const catalogPaths = new Set(QUERY_ROUTE_METADATA.map((r) => r.path));
const contractPaths = new Set(Object.keys(ROUTE_PARAM_CONTRACTS));

for (const p of catalogPaths) {
  if (!contractPaths.has(p)) fail(`catalog 路由缺少参数契约: ${p}（在 route-param-contracts.ts 登记）`);
}
for (const p of contractPaths) {
  if (!catalogPaths.has(p)) fail(`契约登记了 catalog 不存在的路由: ${p}（删除或先登记 catalog）`);
}

// ── 2. per-route 子集校验 ──────────────────────────
let checkedParams = 0;
for (const route of QUERY_ROUTE_METADATA) {
  const contract = ROUTE_PARAM_CONTRACTS[route.path];
  if (!contract) continue; // 覆盖率检查已报

  const allowed = contractAllowedKeys(contract);
  for (const param of route.parameters) {
    checkedParams++;
    if (!allowed.has(param.name)) {
      fail(
        `${route.path} 登记了路由不接受的参数 '${param.name}'` +
        `（运行时会被静默忽略；合法参数见 route-param-contracts.ts 对应契约）`
      );
    }
  }
}

if (failed) {
  console.error(
    '\n  修复指引：catalog 参数名必须与运行时 zod schema / 解析代码的字段名完全一致' +
    '（注意 camelCase，如 startDate 而非 start_date）。'
  );
  process.exit(1);
}

console.log(
  `✓ route-catalog 参数对账通过（${catalogPaths.size} 条路由契约全覆盖，${checkedParams} 个登记参数全部属于运行时合法集合）`
);
