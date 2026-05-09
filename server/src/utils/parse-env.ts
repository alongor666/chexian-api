/**
 * 类型安全的 env 变量解析工具。
 *
 * 设计目标：在 env 解析阶段就严格拒绝非法输入，避免"启动看似成功但运行时配置漂移"。
 * 所有 helper 在解析失败时记录 console.warn 并返回 fallback，不抛异常（启动不阻断）。
 */

/**
 * 安全解析正整数 env 变量。
 *
 * 严格要求字面正整数，拒绝所有部分解析的形式：
 * - "1.5" / "8abc" / "1e2" → parseInt 会"宽容"地返回 1/8/1，看似合法但语义错误
 * - "0" / "-3" / "01" / "abc" / "" → 显然非法
 *
 * 用于连接池/线程池等关键资源参数。
 *
 * @param name env 变量名（仅用于日志）
 * @param value process.env 原始值
 * @param fallback 解析失败或未设置时的默认值（必须是合法正整数）
 */
export function parsePositiveInt(name: string, value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const trimmed = value.trim();
  // 严格字面整数：只允许 1-9 开头的纯数字串
  // 拒绝：前导零、小数点、科学计数法、字母混排、负号
  if (!/^[1-9]\d*$/.test(trimmed)) {
    console.warn(`[env] ${name}="${value}" 不是正整数（要求字面整数 ≥1），使用默认值 ${fallback}`);
    return fallback;
  }
  return parseInt(trimmed, 10);
}
