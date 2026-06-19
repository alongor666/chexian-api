import { describe, it, expect } from 'vitest';
import { hasPathsFrontmatter, findStaleCounts } from '../check-governance.mjs';

// 黄金标准 #2（path-scoped 按需加载）的判据 oracle：
// 带 paths: YAML frontmatter 的 rule = 按需加载（不计入 eager-load 预算）；
// 其余 = 无条件 eager-load（计入预算）。checkRulesEagerLoadBudget 依赖此判据。
describe('hasPathsFrontmatter — rules eager-load 判据', () => {
  it('带 paths: frontmatter（行内数组）→ true（按需加载）', () => {
    expect(hasPathsFrontmatter('---\npaths: ["src/**/*.tsx"]\n---\n\n# 标题')).toBe(true);
  });

  it('带 paths: frontmatter（YAML 列表 + 前导空格）→ true', () => {
    expect(hasPathsFrontmatter('---\n  paths:\n    - "scripts/**"\n---\n# 标题')).toBe(true);
  });

  it('无 frontmatter（直接 H1）→ false（eager-load）', () => {
    expect(hasPathsFrontmatter('# 多分公司 Day-1 上线 SOP（RED LINE）\n\npolicy: append-only')).toBe(false);
  });

  it('有 frontmatter 但无 paths 键 → false（仍 eager-load）', () => {
    expect(hasPathsFrontmatter('---\ndescription: x\n---\n# 标题')).toBe(false);
  });

  it('正文里出现 paths: 但不在 frontmatter → false（不误判）', () => {
    expect(hasPathsFrontmatter('# 标题\n\n详见 paths: 配置说明')).toBe(false);
  });

  it('frontmatter 未闭合（缺第二个 ---）→ false', () => {
    expect(hasPathsFrontmatter('---\npaths: ["a/**"]\n# 标题无闭合')).toBe(false);
  });

  it('空内容 → false', () => {
    expect(hasPathsFrontmatter('')).toBe(false);
  });

  it('paths: 空值/null/注释/空数组 → false（防 verifier P1 空值绕过）', () => {
    expect(hasPathsFrontmatter('---\npaths:\n---\n# 标题')).toBe(false);
    expect(hasPathsFrontmatter('---\npaths: null\n---\n# 标题')).toBe(false);
    expect(hasPathsFrontmatter('---\npaths: # 尚未配置\n---\n# 标题')).toBe(false);
    expect(hasPathsFrontmatter('---\npaths: []\n---\n# 标题')).toBe(false);
  });
});

// 黄金标准 #8（避免会过期的快照）的判据 oracle：
// 检测会随迭代漂移的硬编码计数（指标/字段/SQL 模块/子路由/测试文件），
// 不误伤稳定枚举（11 类）/ 约数（20+、50+）/ 指针化表述。
describe('findStaleCounts — CLAUDE.md 漂移计数检测', () => {
  it('命中「52 个指标」', () => {
    expect(findStaleCounts('| 指标注册表 | 52 个指标 |')).toHaveLength(1);
  });

  it('命中「228 测试文件」', () => {
    expect(findStaleCounts('单元测试 228 测试文件')).toHaveLength(1);
  });

  it('命中「58 个字段」与「22 子路由」（多行多命中）', () => {
    expect(findStaleCounts('58 个字段\nquery 22 子路由')).toHaveLength(2);
  });

  it('不误伤稳定枚举「11 类」', () => {
    expect(findStaleCounts('客户类别 11 类枚举')).toEqual([]);
  });

  it('不误伤约数「50+ 路由」「20+ 变量」', () => {
    expect(findStaleCounts('API 路由 50+ · 环境变量 20+ 变量')).toEqual([]);
  });

  it('命中扩展模式：字段定义/路由/域元数据/域命名空间（verifier P2）', () => {
    expect(findStaleCounts('38 字段定义')).toHaveLength(1);
    expect(findStaleCounts('64 路由 path→运行时')).toHaveLength(1);
    expect(findStaleCounts('9 域元数据')).toHaveLength(1);
    expect(findStaleCounts('13 域命名空间子客户端')).toHaveLength(1);
  });

  it('指针化后的表述不命中', () => {
    expect(findStaleCounts('数量以 validate.ts 为准；以 fields.json 为准')).toEqual([]);
  });
});
