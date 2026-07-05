import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import {
  classifyArchViolations,
  normalizeArchTarget,
  extractModuleSpecifiers,
  isValidArchAllowMark,
} from '../check-governance.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const ROOT = path.resolve(import.meta.dirname, '../..');

// normalizeArchTarget 把别名/相对路径归一为「逻辑层」标识，供 classify 匹配。
// 注：相对路径解析依赖文件所在绝对路径相对 ROOT 的位置。
function abs(relFromRoot) {
  return path.join(ROOT, relFromRoot);
}

describe('normalizeArchTarget — 别名/相对路径归一', () => {
  it('别名 @/features/dashboard → features/dashboard', () => {
    expect(normalizeArchTarget('@/features/dashboard/utils/kpiStatus', abs('src/widgets/x.ts')))
      .toBe('features/dashboard/utils/kpiStatus');
  });

  it('别名 @/shared/... 归一去 @/', () => {
    expect(normalizeArchTarget('@/shared/hooks/usePerspective', abs('src/features/growth/x.ts')))
      .toBe('shared/hooks/usePerspective');
  });

  it('相对路径 ../../features/dashboard → 去 src/ 前缀', () => {
    // 文件在 src/widgets/kpi/EnhancedKpiCard/types.ts，引 ../../features/...
    const r = normalizeArchTarget('../../features/dashboard/utils/kpiStatus',
      abs('src/widgets/kpi/types.ts'));
    expect(r).toBe('features/dashboard/utils/kpiStatus');
  });

  it('裸 server/src 说明符原样保留', () => {
    expect(normalizeArchTarget('server/src/sql/cross-sell', abs('src/features/dashboard/h.ts')))
      .toBe('server/src/sql/cross-sell');
  });
});

describe('classifyArchViolations — 7 条边界规则', () => {
  it('(a) widgets → features 命中', () => {
    expect(classifyArchViolations('src/widgets/kpi/x.ts', 'features/dashboard/utils/kpiStatus'))
      .toHaveLength(1);
  });

  it('(b) shared → features 命中', () => {
    expect(classifyArchViolations('src/shared/contexts/FilterContext.tsx', 'features/dashboard/orgSalesman'))
      .toHaveLength(1);
  });

  it('(c) features → server 命中（裸 server/ 前缀）', () => {
    expect(classifyArchViolations('src/features/dashboard/hooks/h.ts', 'server/src/sql/x'))
      .toHaveLength(1);
  });

  it('(d) growth → dashboard 横向命中', () => {
    expect(classifyArchViolations('src/features/growth/components/Panel.tsx', 'features/dashboard'))
      .toHaveLength(1);
  });

  it('(e) quote-conversion → filters 横向命中', () => {
    expect(classifyArchViolations('src/features/quote-conversion/components/GlobalFilters.tsx', 'features/filters/CollapsibleFilterSection'))
      .toHaveLength(1);
  });

  it('(c-扩) shared → server 命中（codex gate-2 P1：前端全层禁 server）', () => {
    expect(classifyArchViolations('src/shared/api/client.ts', 'server/src/config/x'))
      .toHaveLength(1);
  });

  it('(c-扩) widgets → server 命中', () => {
    expect(classifyArchViolations('src/widgets/kpi/x.ts', 'server/src/sql/y'))
      .toHaveLength(1);
  });

  it('合法：features 引用 shared 不命中', () => {
    expect(classifyArchViolations('src/features/growth/x.ts', 'shared/hooks/usePerspective'))
      .toEqual([]);
  });

  it('合法：widgets 引用 shared 不命中', () => {
    expect(classifyArchViolations('src/widgets/kpi/x.ts', 'shared/utils/kpiStatus'))
      .toEqual([]);
  });

  it('合法：growth 引用 quote-conversion 不在 denylist（仅守 B330 列出的两条横向）', () => {
    expect(classifyArchViolations('src/features/growth/x.ts', 'features/quote-conversion'))
      .toEqual([]);
  });

  it('边界精度：features/dashboard-foo 不应被 features/dashboard 误命中', () => {
    expect(classifyArchViolations('src/features/growth/x.ts', 'features/dashboard-foo'))
      .toEqual([]);
  });

  it('不误伤：dashboard 自身文件引 dashboard（from 不匹配 growth/quote-conversion）', () => {
    expect(classifyArchViolations('src/features/dashboard/x.ts', 'features/dashboard/y'))
      .toEqual([]);
  });
});

describe('extractModuleSpecifiers — AST 覆盖各 import 形式', () => {
  it('覆盖 import / import type / export from / 动态 import / require', () => {
    const src = [
      "import a from '@/features/dashboard/a';",
      "import type { B } from '../../features/dashboard/b';",
      "export { C } from 'server/src/sql/c';",
      "const d = await import('@/features/filters/d');",
      "const e = require('@/features/dashboard/e');",
      "import normal from '@/shared/ok';",
    ].join('\n');
    const specs = extractModuleSpecifiers(ts, src, abs('src/features/growth/x.tsx'));
    const found = specs.map((s) => s.spec);
    expect(found).toContain('@/features/dashboard/a');
    expect(found).toContain('../../features/dashboard/b');
    expect(found).toContain('server/src/sql/c');
    expect(found).toContain('@/features/filters/d');
    expect(found).toContain('@/features/dashboard/e');
    expect(found).toContain('@/shared/ok');
  });

  it('记录行号（0-based）正确', () => {
    const src = "// line0\nimport a from '@/features/x';";
    const specs = extractModuleSpecifiers(ts, src, abs('src/widgets/x.ts'));
    expect(specs[0].line).toBe(1);
  });

  it('覆盖无插值模板字符串 import(`...`) / require(`...`)（codex gate-2 P1 防绕过）', () => {
    const src = [
      'const a = await import(`@/features/dashboard/a`);',
      'const b = require(`server/src/sql/b`);',
    ].join('\n');
    const specs = extractModuleSpecifiers(ts, src, abs('src/features/growth/x.ts'));
    const found = specs.map((s) => s.spec);
    expect(found).toContain('@/features/dashboard/a');
    expect(found).toContain('server/src/sql/b');
  });

  it('有插值的模板字符串不抽取（无法静态判定，避免误报）', () => {
    const src = 'const a = await import(`@/features/${name}`);';
    const specs = extractModuleSpecifiers(ts, src, abs('src/features/growth/x.ts'));
    expect(specs).toHaveLength(0);
  });
});

describe('isValidArchAllowMark — 逃生阀须带 backlog/PR 引用', () => {
  it('裸 marker（无引用）→ 无效（防回归后门）', () => {
    expect(isValidArchAllowMark('// governance-allow: arch-boundary')).toBe(false);
  });

  it('marker + B 编号 → 有效', () => {
    expect(isValidArchAllowMark('// governance-allow: arch-boundary B330 历史正当依赖')).toBe(true);
  });

  it('marker + 引用但无理由 → 无效（codex gate-2 P2：须带一句理由）', () => {
    expect(isValidArchAllowMark('// governance-allow: arch-boundary B330')).toBe(false);
    expect(isValidArchAllowMark('// governance-allow: arch-boundary #641')).toBe(false);
  });

  it('marker + PR 号 → 有效', () => {
    expect(isValidArchAllowMark('// governance-allow: arch-boundary #641 理由')).toBe(true);
  });

  it('marker + backlog uid → 有效', () => {
    expect(isValidArchAllowMark('// governance-allow: arch-boundary 2026-06-15-claude-2e017d 理由')).toBe(true);
  });

  it('有引用但无 marker → 无效', () => {
    expect(isValidArchAllowMark('// see B330')).toBe(false);
  });
});

// 端到端：把违规说明符喂全链路（AST → normalize → classify），证明 7 条规则真能拦。
describe('端到端：违规 import 被链路捕获', () => {
  const cases = [
    { file: 'src/widgets/kpi/EnhancedKpiCard/types.ts', spec: '@/features/dashboard/utils/kpiStatus' },
    { file: 'src/shared/contexts/FilterContext.tsx', spec: '@/features/dashboard/orgSalesman' },
    { file: 'src/features/dashboard/hooks/h.ts', spec: 'server/src/sql/cross-sell' },
    { file: 'src/features/growth/components/Panel.tsx', spec: '@/features/dashboard/usePerspective' },
    { file: 'src/features/quote-conversion/components/GlobalFilters.tsx', spec: '@/features/filters/CollapsibleFilterSection' },
  ];
  for (const { file, spec } of cases) {
    it(`${file} import '${spec}' → 违规`, () => {
      const src = `import x from '${spec}';`;
      const specs = extractModuleSpecifiers(ts, src, abs(file));
      const target = normalizeArchTarget(specs[0].spec, abs(file));
      expect(classifyArchViolations(file, target).length).toBeGreaterThan(0);
    });
  }

  it('合法 import shared 全链路不命中', () => {
    const file = 'src/features/growth/components/Panel.tsx';
    const src = "import { usePerspective } from '@/shared/hooks/usePerspective';";
    const specs = extractModuleSpecifiers(ts, src, abs(file));
    const target = normalizeArchTarget(specs[0].spec, abs(file));
    expect(classifyArchViolations(file, target)).toEqual([]);
  });
});
