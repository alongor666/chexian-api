/**
 * discover-fields-view 纯函数单测（CI 安全：无 DB / Express 依赖）
 *
 * 覆盖 P1.5 字段查询一致性的核心断言：column/queryable/actualType/note 的派生逻辑，
 * 以及 verbose 才暴露 ETL 入库元数据。
 */
import { describe, it, expect } from 'vitest';
import {
  buildFieldsView,
  type FieldsJsonEntry,
  type DescribeColumn,
} from '../discover-fields-view.js';

const FIELDS: FieldsJsonEntry[] = [
  {
    id: 'premium',
    label: '保费',
    required: true,
    dataTypes: ['DOUBLE', 'DECIMAL'],
    aliases: ['premium', 'signed_premium', 'signedPremium', '保费', '签单保费'],
    description: '签单/批改保费',
  },
  {
    id: 'org_level_3',
    label: '三级机构',
    required: true,
    dataTypes: ['VARCHAR', 'TEXT'],
    aliases: ['org_level_3', '三级机构'],
  },
  {
    id: 'is_renewal',
    label: '是否续保',
    required: true,
    dataTypes: ['VARCHAR', 'BOOLEAN', 'INTEGER'],
    aliases: ['is_renewal', '是否续保', '续保'],
  },
  {
    id: 'is_commercial_insure',
    label: '是否交商统保',
    required: false,
    dataTypes: ['VARCHAR', 'TEXT'],
    aliases: ['is_commercial_insure', '交商统保', '交商同保'],
    description: '交商统保/套单标识',
  },
  {
    id: 'compulsory_ncd_factor',
    label: '交强险NCD系数',
    derived: true,
    dataTypes: ['DOUBLE'],
    aliases: ['compulsory_ncd_factor', '交强险NCD系数'],
  },
  {
    id: 'ghost_col',
    label: '幽灵列',
    dataTypes: ['VARCHAR'],
    aliases: ['ghost_col'],
  },
  {
    id: 'applicant_name',
    label: '投保人名称',
    required: false,
    sensitive: true,
    dataTypes: ['VARCHAR', 'TEXT'],
    aliases: ['applicant_name', '投保人'],
    description: '投保人名称（个人敏感信息）',
  },
];

// PolicyFact 真实 schema：premium/org_level_3/is_renewal/is_commercial_insure 在；
// compulsory_ncd_factor（派生未物化）与 ghost_col（口径漂移）不在。
const DESCRIBE: DescribeColumn[] = [
  { name: 'premium', type: 'DOUBLE' },
  { name: 'org_level_3', type: 'VARCHAR' },
  { name: 'is_renewal', type: 'BOOLEAN' },
  { name: 'is_commercial_insure', type: 'VARCHAR' },
  // applicant_name 物理列真实存在 —— 用于断言 sensitive 屏蔽优先于「可查真值」
  { name: 'applicant_name', type: 'VARCHAR' },
];

function byId(views: ReturnType<typeof buildFieldsView>, id: string) {
  const v = views.find((x) => x.id === id);
  if (!v) throw new Error(`field ${id} not found`);
  return v;
}

describe('buildFieldsView — 可查真值标注', () => {
  it('column 恒等于 id（唯一可 SELECT 的列名）', () => {
    const views = buildFieldsView(FIELDS, DESCRIBE);
    for (const v of views) expect(v.column).toBe(v.id);
  });

  it('真实列 → queryable=true + actualType 来自 DESCRIBE + 无 note', () => {
    const premium = byId(buildFieldsView(FIELDS, DESCRIBE), 'premium');
    expect(premium.queryable).toBe(true);
    expect(premium.actualType).toBe('DOUBLE');
    expect(premium.groupable).toBe(false);
    expect(premium.note).toBeUndefined();
  });

  it('groupable 由真实类型判定（VARCHAR → 可分组），覆盖声明类型', () => {
    const org = byId(buildFieldsView(FIELDS, DESCRIBE), 'org_level_3');
    expect(org.queryable).toBe(true);
    expect(org.actualType).toBe('VARCHAR');
    expect(org.groupable).toBe(true);
  });

  it('派生且未物化 → queryable=false + 派生提示', () => {
    const f = byId(buildFieldsView(FIELDS, DESCRIBE), 'compulsory_ncd_factor');
    expect(f.queryable).toBe(false);
    expect(f.actualType).toBeNull();
    expect(f.derived).toBe(true);
    expect(f.note).toContain('派生');
    expect(f.note).toContain('不可直接 SELECT');
  });

  it('非派生但缺列 → queryable=false + 口径漂移提示', () => {
    const f = byId(buildFieldsView(FIELDS, DESCRIBE), 'ghost_col');
    expect(f.queryable).toBe(false);
    expect(f.derived).toBe(false);
    expect(f.note).toContain('口径漂移');
  });

  it('is_* 真实类型非布尔（VARCHAR 枚举）→ 伪布尔告警', () => {
    const f = byId(buildFieldsView(FIELDS, DESCRIBE), 'is_commercial_insure');
    expect(f.queryable).toBe(true);
    expect(f.actualType).toBe('VARCHAR');
    expect(f.note).toContain('非布尔');
  });

  it('is_* 真实类型为布尔 → 无伪布尔告警', () => {
    const f = byId(buildFieldsView(FIELDS, DESCRIBE), 'is_renewal');
    expect(f.queryable).toBe(true);
    expect(f.actualType).toBe('BOOLEAN');
    expect(f.note).toBeUndefined();
  });
});

describe('buildFieldsView — schema 不可用降级', () => {
  it('describeColumns=null → queryable/actualType=null，groupable 退回声明类型', () => {
    const views = buildFieldsView(FIELDS, null);
    const org = byId(views, 'org_level_3');
    expect(org.queryable).toBeNull();
    expect(org.actualType).toBeNull();
    expect(org.groupable).toBe(true); // VARCHAR 在声明 dataTypes 中
    const premium = byId(views, 'premium');
    expect(premium.groupable).toBe(false);
  });
});

describe('buildFieldsView — ETL 入库元数据仅 verbose 暴露', () => {
  it('默认不含 ingestAliases / ingestTypes（消灭别名陷阱）', () => {
    const premium = byId(buildFieldsView(FIELDS, DESCRIBE), 'premium');
    expect(premium.ingestAliases).toBeUndefined();
    expect(premium.ingestTypes).toBeUndefined();
    // 默认输出里不出现 ETL 别名 signed_premium
    expect(JSON.stringify(premium)).not.toContain('signed_premium');
  });

  it('verbose=true 才带出 ingestAliases / ingestTypes', () => {
    const premium = byId(buildFieldsView(FIELDS, DESCRIBE, { verbose: true }), 'premium');
    expect(premium.ingestAliases).toContain('signed_premium');
    expect(premium.ingestTypes).toContain('DOUBLE');
  });
});

describe('buildFieldsView — 敏感字段隐私红线（PR #1129 回归锁）', () => {
  it('sensitive 字段即便物理列真实存在 → queryable=false + groupable=false + 敏感提示', () => {
    const v = byId(buildFieldsView(FIELDS, DESCRIBE), 'applicant_name');
    expect(v.queryable).toBe(false);
    expect(v.actualType).toBeNull();
    expect(v.groupable).toBe(false);
    expect(v.note).toContain('敏感');
  });

  it('schema 不可用（describeColumns=null）时 sensitive 字段仍不可查不可分组', () => {
    const v = byId(buildFieldsView(FIELDS, null), 'applicant_name');
    expect(v.queryable).toBe(false);
    expect(v.groupable).toBe(false);
    expect(v.note).toContain('敏感');
  });

  it('groupable=true 过滤（cx fields --groupable 消费路径）不包含敏感字段', () => {
    const views = buildFieldsView(FIELDS, DESCRIBE);
    const groupables = views.filter((f) => f.groupable).map((f) => f.id);
    expect(groupables).not.toContain('applicant_name');
  });
});
