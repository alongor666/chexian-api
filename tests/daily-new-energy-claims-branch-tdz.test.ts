import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// 回归守卫（2026-07-18）：daily.mjs main() 的 subcommand switch 里，
// 'new_energy'/'new_energy_claims' 分支曾误用同函数作用域内、更靠后才 const 声明的
// BRANCH_CODE（main/premium 流程专用），导致子命令模式下必现
// `ReferenceError: Cannot access 'BRANCH_CODE' before initialization`（暂时性死区）。
// 该 case 已在上文（subcommand 路由段）正确解析出 __branchSub，本应使用它。
// bug 自 2026-06-22(fa4c98d6) 引入，因该子命令此前从未被直接调用而潜伏近一个月，
// 2026-07-18 双批发布拆分（#1143）首次以 `node daily.mjs new_energy_claims` 直调形式
// 触发晚批必现失败。本测试静态锁定该 case 代码块不得再引用裸 BRANCH_CODE。
describe('daily.mjs new_energy_claims 分支：BRANCH_CODE 暂时性死区回归守卫', () => {
  it('new_energy/new_energy_claims case 代码块只使用 __branchSub，不引用裸 BRANCH_CODE', () => {
    const source = readFileSync(
      join(process.cwd(), '数据管理', 'daily.mjs'),
      'utf8',
    );
    const caseStart = source.indexOf("case 'new_energy':");
    const caseEnd = source.indexOf("case 'renewal_tracker':");
    expect(caseStart).toBeGreaterThan(-1);
    expect(caseEnd).toBeGreaterThan(caseStart);

    const block = source.slice(caseStart, caseEnd);
    // 只允许出现在注释里提及 "BRANCH_CODE" 这个词本身；真正的代码引用必须是 __branchSub。
    const codeLines = block
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'));
    const bareBranchCodeRefs = codeLines.filter((line) => /\bBRANCH_CODE\b/.test(line));
    expect(bareBranchCodeRefs).toEqual([]);
    expect(block).toContain('__branchSub');
  });
});
