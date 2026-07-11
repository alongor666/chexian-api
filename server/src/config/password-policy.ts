/**
 * 密码策略（全员密码体系改造 · 阶段一）
 *
 * 唯一事实源：change-password 与 activate 两条设密链路共用本模块；
 * 前端 ChangePasswordPage 同步实现同一套校验（体验层），后端本模块强制（安全层）。
 *
 * 口径（用户拍板，2026-07-11）：
 *   - 长度 ≥ 8 位
 *   - 字符类别 ≥ 2 类（大写字母 / 小写字母 / 数字 / 符号 四类中至少两类）
 *   - 黑名单：包含 chexian 字样（覆盖历史统一初始密码 Chexian@2026 及其变体）、
 *     包含用户名（大小写不敏感）、常见弱密码 top 表精确命中
 */

/**
 * 常见弱密码 top 表（小写比对，精确命中即拒绝）。
 * 收录：纯数字连号/重复、键盘序、英文常见词 + 数字组合、国内高频弱密。
 */
export const COMMON_WEAK_PASSWORDS: readonly string[] = [
  '12345678', '123456789', '1234567890', '11111111', '88888888', '66666666',
  '12341234', '12344321', '87654321', '11223344', '11112222',
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd',
  'qwertyui', 'qwerty123', 'qwertyuiop', '1qaz2wsx', '1q2w3e4r', 'q1w2e3r4',
  'asdfghjk', 'asd123456', 'abc12345', 'abcd1234', 'abc123456', 'a1234567', 'a12345678',
  'iloveyou', 'sunshine', 'admin123', 'root1234', 'letmein1',
  'woaini520', 'woaini1314', 'aa123456', 'qq123456', '123456aa', '520131400',
];

/** 密码中禁止出现的系统相关字样（小写包含即拒绝；覆盖 Chexian@2026 等历史初始密码变体） */
export const FORBIDDEN_PASSWORD_SUBSTRINGS: readonly string[] = ['chexian'];

const WEAK_SET = new Set(COMMON_WEAK_PASSWORDS.map((p) => p.toLowerCase()));

/** 统计字符类别数：大写 / 小写 / 数字 / 符号 */
function countCharClasses(password: string): number {
  let classes = 0;
  if (/[A-Z]/.test(password)) classes += 1;
  if (/[a-z]/.test(password)) classes += 1;
  if (/[0-9]/.test(password)) classes += 1;
  if (/[^A-Za-z0-9]/.test(password)) classes += 1;
  return classes;
}

/**
 * 校验新密码强度。返回违规原因（中文，直接回给用户），null = 通过。
 * @param password 已归一化（NFKC + trim）的明文新密码
 * @param context.username 账号用户名（黑名单校验用；缺省跳过用户名相关规则）
 */
export function validatePasswordPolicy(
  password: string,
  context: { username?: string } = {}
): string | null {
  if (password.length < 8) {
    return '新密码长度至少 8 位';
  }
  if (countCharClasses(password) < 2) {
    return '新密码至少包含大写字母、小写字母、数字、符号中的两类';
  }
  const lower = password.toLowerCase();
  for (const banned of FORBIDDEN_PASSWORD_SUBSTRINGS) {
    if (lower.includes(banned)) {
      return '新密码不能包含 chexian 等系统相关字样';
    }
  }
  if (WEAK_SET.has(lower)) {
    return '新密码过于常见，请更换更独特的密码';
  }
  const username = context.username?.trim().toLowerCase();
  if (username && lower.includes(username)) {
    return '新密码不能包含用户名';
  }
  return null;
}
