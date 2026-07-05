export function formatPct(numerator: number, denominator: number): string {
  if (denominator === 0) return '—';
  return (numerator / denominator * 100).toFixed(1) + '%';
}

/**
 * 团队简称化（展示层）
 *
 * 规则按优先级匹配：
 * 1. 后缀「业务团队」→ 删除（"天府福江业务团队" → "天府福江"）
 * 2. 后缀「业务X部」→ "X部"（"乐山业务一部" → "乐山一部"）
 * 3. 后缀「团队」→ 删除（"龙泉业务团队" → "龙泉"；"本部团队" → "本部"）
 *
 * 不匹配任何规则时原样返回（降级安全）。空值返回占位符。
 */
export function shortenTeamName(fullName: string | null | undefined): string {
  if (!fullName) return '(未分团队)';
  const name = fullName.trim();
  if (name.endsWith('业务团队')) {
    return name.slice(0, -'业务团队'.length) || name;
  }
  const bizDeptMatch = name.match(/^(.+?)业务([一二三四五六七八九十]+部)$/);
  if (bizDeptMatch) {
    return bizDeptMatch[1] + bizDeptMatch[2];
  }
  if (name.endsWith('团队')) {
    return name.slice(0, -'团队'.length) || name;
  }
  return name;
}

/**
 * 业务员命名清洗（展示层）
 *
 * 去掉开头连续数字工号（如 "110072851曾志超" → "曾志超"）。
 * 如果去完数字结果为空（理论不应出现），返回原值。空值返回占位符。
 */
export function stripSalesmanCode(fullName: string | null | undefined): string {
  if (!fullName) return '(未分配)';
  const stripped = fullName.replace(/^\d+/, '').trim();
  return stripped || fullName;
}
