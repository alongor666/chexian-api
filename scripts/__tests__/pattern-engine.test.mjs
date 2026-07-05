/**
 * 禁止模式族 红/绿 fixture 对照（governance 奥卡姆批次二的能力不降 oracle）
 *
 * 每条规则至少一红（人为违规样本 → 必须拦截）一绿（干净/豁免样本 → 必须放行），
 * 证明从手写函数迁移到声明式规则表后拦截能力零损失。
 * 末尾的完备性断言强制：PATTERN_RULES 每新增一条规则必须同步补 fixture。
 */
import { describe, it, expect } from 'vitest';
import { scanContentWithRule } from '../governance/pattern-engine.mjs';
import { PATTERN_RULES } from '../governance/pattern-rules.mjs';

const ruleById = (id) => {
  const r = PATTERN_RULES.find((x) => x.id === id);
  if (!r) throw new Error(`规则不存在：${id}`);
  return r;
};
const scan = (id, content) => scanContentWithRule(ruleById(id), content);
const errors = (vs) => vs.filter((v) => v.severity === 'error');
const warns = (vs) => vs.filter((v) => v.severity === 'warning');

/** 每条规则的红绿样本（red: 期望拦截数；green: 期望零违规） */
const FIXTURES = {
  'dc002-current-date': {
    red: ["const sql = `WHERE policy_date >= CURRENT_DATE`;"],
    green: [
      // DC-002 Exception 注释在上方 2 行内 → 豁免
      "// DC-002 Exception: 数据新鲜度探针，与用户筛选无关\nconst probe = `SELECT CURRENT_DATE`;",
      '// 注释里提到 CURRENT_DATE 不算',
    ],
  },
  'dc002-or-filters': {
    red: ['const start = filters.startDate || defaultStart;'],
    green: ['const start = filters.startDate ?? defaultStart;'],
  },
  'dc002-optional-date': {
    red: ['export function build(startDate : string ?, other: number) {'],
    green: ['export function build(filters: AdvancedFilterState) {'],
  },
  'etl-multisheet': {
    red: ['df = pd.read_excel(input_file, dtype=STR_FORCE)'],
    green: [
      '# 旧写法 pd.read_excel(input_file) 已废弃',
      'df = load_excel_all_sheets(input_file, dtype=STR_FORCE_COLS)',
    ],
  },
  'empty-catch': {
    red: ['try { a(); } catch (e) {}', 'try { b(); } catch {\n  \n}'],
    green: ['try { a(); } catch (e) { logger.warn("ctx", e); }'],
  },
  'salesman-aggkey': {
    red: ["GROUP BY REGEXP_REPLACE(salesman_name, '^[0-9]+', '')"],
    green: [
      // 逃生阀在上一行 → 豁免
      "-- governance-allow: salesman-aggkey 纯展示列，无独立 display 可挂\nSELECT REGEXP_REPLACE(salesman_name, '^[0-9]+', '') AS display_name",
      'GROUP BY salesman_name',
    ],
  },
  'filter-params-bypass': {
    red: ['params.customerCategories = picked;', "query['isNev'] = flag;"],
    green: [
      'if (params.customerCategories === undefined) return;', // 比较非赋值
      'const cats = params.customerCategories;', // 读取非赋值
      '// governance-allow: filter-params-mapping\nmapped.isNev = capability.isNev ? raw.isNev : undefined;',
    ],
  },
  'bundle-routes-guard': {
    red: ['const data = usePerformanceBundle({ enabled: ready });'],
    green: [
      "import { ENABLE_BUNDLE_ROUTES } from '@/shared/api/client';\nconst data = usePerformanceBundle({ enabled: ready && ENABLE_BUNDLE_ROUTES });",
      'const other = useSomethingElse();', // 无 trigger
    ],
  },
  'cube-routes-ssot': {
    red: ["const SHADOW_ROUTES = ['trend', 'growth', 'cost', 'kpi', 'salesman-ranking'];"],
    green: ["import { SHADOW_KEYS } from '../shared/cube-routes.mjs';"],
  },
  'branch-code-fallback': {
    red: ["const branch = process.env.BRANCH_CODE ?? 'SC';", "const b = raw || 'SC';"],
    green: [
      "const branch = resolveBranchCode(process.env.BRANCH_CODE ?? 'SC', 'etl');", // 已合规形态豁免
      "// 反例文档：process.env.BRANCH_CODE ?? 'SC'", // 注释行
      "const b = raw || 'SX_FALLBACK_NOT_SC_LITERAL';", // 非 'SC' 字面量
    ],
  },
};

describe('禁止模式族 红/绿 fixture（能力不降 oracle）', () => {
  for (const [id, fx] of Object.entries(FIXTURES)) {
    describe(id, () => {
      it('红样本必须拦截', () => {
        for (const sample of fx.red) {
          const vs = scan(id, sample);
          expect(vs.length, `红样本未被拦截：${JSON.stringify(sample)}`).toBeGreaterThan(0);
        }
      });
      it('绿样本必须放行', () => {
        for (const sample of fx.green) {
          const vs = scan(id, sample);
          expect(vs, `绿样本被误拦：${JSON.stringify(sample)}`).toEqual([]);
        }
      });
    });
  }
});

describe('语义细节保真（迁移自旧手写函数的特殊行为）', () => {
  it('dc002-or-filters：日期字段 || 是 error，其余 filters 字段是 warning', () => {
    const err = scan('dc002-or-filters', 'const s = filters.startDate || d;');
    expect(errors(err)).toHaveLength(1);
    const warn = scan('dc002-or-filters', "const lvl = filters.riskLevel || 'all';");
    expect(errors(warn)).toHaveLength(0);
    expect(warns(warn)).toHaveLength(1);
  });

  it('dc002-current-date：firstHitPerFile 每文件只报第一处', () => {
    const vs = scan(
      'dc002-current-date',
      'const a = `CURRENT_DATE`;\nconst b = `NOW()`;\nconst c = `CURDATE()`;',
    );
    expect(vs).toHaveLength(1);
    expect(vs[0].line).toBe(1);
  });

  it('empty-catch：跨行空块也拦（\\s 跨换行）且逐处上报', () => {
    const vs = scan('empty-catch', 'catch (e) {}\nfoo();\ncatch {\n\n}');
    expect(vs).toHaveLength(2);
  });

  it('salesman-aggkey：逃生阀在命中行同行也生效', () => {
    const vs = scan(
      'salesman-aggkey',
      "REGEXP_REPLACE(salesman_name, '^[0-9]+', '') -- governance-allow: salesman-aggkey 理由",
    );
    expect(vs).toEqual([]);
  });

  it('filter-params-bypass：断行赋值（= 在行尾）不漏检', () => {
    const vs = scan('filter-params-bypass', 'params.customerCategories =\n  picked;');
    expect(vs).toHaveLength(1);
  });
});

describe('完备性：每条规则必须有红绿 fixture', () => {
  it('PATTERN_RULES 与 FIXTURES 一一对应', () => {
    const ruleIds = PATTERN_RULES.map((r) => r.id).sort();
    const fixtureIds = Object.keys(FIXTURES).sort();
    expect(ruleIds).toEqual(fixtureIds);
    for (const [id, fx] of Object.entries(FIXTURES)) {
      expect(fx.red.length, `${id} 缺红样本`).toBeGreaterThan(0);
      expect(fx.green.length, `${id} 缺绿样本`).toBeGreaterThan(0);
    }
  });
});
