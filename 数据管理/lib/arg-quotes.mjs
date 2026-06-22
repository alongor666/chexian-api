/**
 * argv 参数「最外层一对双引号」剥离 — 纯函数，可单测
 *
 * 背景：daily.mjs 早期用 execSync（shell 字符串拼接），路径必须包成 `"${path}"`
 * 以防空格拆分 / 注入；后迁到 spawnSync（argv 数组按字面量传参，引号反而会被
 * Python argparse 当成路径的一部分）。迁移时未逐个去引号，而是在 runPythonScript
 * 内中央剥离每个参数最外层的一对双引号 —— 历史 `"${path}"` 调用点因此仍安全，
 * 裸路径则是 no-op。
 *
 * ⚠️ 此剥离 **仅** 发生在 runPythonScript 内。任何绕过 runPythonScript 的裸
 * spawnSync / execFileSync 若照搬 `"${path}"` 写法，引号不会被剥离 → Python 端
 * Path('"…"').exists() 判 false → 静默跳过（new_energy_claims 曾踩此坑）。该不变量
 * 由 governance 闸「spawn 参数引号安全」+ tests/arg-quotes.test.ts 双重锁定。
 *
 * daily.mjs 顶层执行 main() 无法被 import，剥离逻辑抽到 lib/ 才能被 vitest 直接
 * import 单测（与 lib/claims-freshness.mjs / lib/shard-classify.mjs 同一模式）。
 */

/**
 * 剥离单个参数最外层的一对双引号。
 * 仅当字符串首尾「都」是双引号且长度 ≥ 2 时剥离；否则原样返回
 * （对裸 flag 如 `--policy-dir`、裸路径、单边引号都是 no-op）。
 */
export function stripOuterDoubleQuotes(arg) {
  const s = String(arg);
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

/** 对整个 argv 数组逐元素剥离最外层双引号。 */
export function stripArgQuotes(args) {
  return args.map(stripOuterDoubleQuotes);
}
