/**
 * 发现层 · 字段视图构造（纯函数，无 DB/Express 依赖 → CI 可单测）
 *
 * 解决「`cx fields` 说的列名 ≠ `cx sql` 能查的列名」的别名陷阱（计划 P1.5 / F1–F5）：
 * 用 PolicyFact 的真实 schema（DESCRIBE 结果）给每个注册字段标注「可查真值」——
 *   - column     : 唯一可在 cx sql 中 SELECT 的列名（= id）
 *   - queryable  : 该列是否真实存在于 PolicyFact（null = schema 暂不可用）
 *   - actualType : PolicyFact 中的真实 DuckDB 类型（查询真值，区别于 ETL 入库类型）
 *   - note       : 使用警示（派生未物化 / 口径漂移 / is_* 伪布尔）
 * ETL 入库别名（aliases）与入库可接受类型（dataTypes）默认隐藏，仅 verbose 输出，
 * 并明确标注为「入库匹配源 Excel 列用，不可 SELECT」，避免再被当成可查列名。
 */

/** fields.json 单条字段定义（与 field-registry/fields.json 结构对齐） */
export interface FieldsJsonEntry {
  id: string;
  label: string;
  sourceColumn?: string | null;
  required?: boolean;
  derived?: boolean;
  /** 个人敏感字段（如投保人名称）：分析查询面必须拒绝查询/分组，见 mapping.ts SENSITIVE_FIELDS */
  sensitive?: boolean;
  dataTypes: string[];
  aliases: string[];
  description?: string;
}

/** PolicyFact DESCRIBE 投影（真实列名 + 真实类型） */
export interface DescribeColumn {
  name: string;
  type: string;
}

/** /api/discover/fields 单条输出（cx fields 渲染源） */
export interface FieldView {
  /** 唯一可在 cx sql 中 SELECT 的列名（= id） */
  column: string;
  /** 兼容键（MCP / 旧消费方读取），值同 column */
  id: string;
  label: string;
  /** 是否真实存在于 PolicyFact；null = schema 暂不可用（DESCRIBE 失败） */
  queryable: boolean | null;
  /** PolicyFact 中的真实 DuckDB 类型（查询真值）；不可查或未知时为 null */
  actualType: string | null;
  groupable: boolean;
  derived: boolean;
  /** 使用警示，仅在有必要时出现 */
  note?: string;
  description: string;
  /** verbose 专属：ETL 入库可接受类型（非查询类型） */
  ingestTypes?: string[];
  /** verbose 专属：ETL 入库源列别名（不可 SELECT） */
  ingestAliases?: string[];
}

const GROUPABLE_TYPES = ['VARCHAR', 'TEXT', 'STRING'] as const;

/** 基于真实类型判定可分组（含参数化类型，如 VARCHAR(255)） */
function typeIsGroupable(actualType: string): boolean {
  const up = actualType.toUpperCase();
  return GROUPABLE_TYPES.some((g) => up.includes(g));
}

/** schema 不可用时退回 fields.json 声明类型判定 */
function declaredGroupable(dataTypes: readonly string[]): boolean {
  return dataTypes.some((t) => GROUPABLE_TYPES.includes(t.toUpperCase() as (typeof GROUPABLE_TYPES)[number]));
}

function computeNote(
  field: FieldsJsonEntry,
  derived: boolean,
  queryable: boolean | null,
  actualType: string | null,
): string | undefined {
  if (queryable === false) {
    return derived
      ? '派生字段，未物化在 PolicyFact，需查询期 CASE WHEN 计算，不可直接 SELECT'
      : 'fields.json 声明的列未出现在 PolicyFact，当前不可直接查询（疑似口径漂移）';
  }
  // is_* 前缀但真实类型非布尔（如 is_commercial_insure 为 VARCHAR 枚举「套单/非套单」）
  if (queryable === true && actualType && field.id.startsWith('is_') && !/BOOL/i.test(actualType)) {
    return `实际类型 ${actualType}（字符串枚举，非布尔）；勿把 ${field.id} 当布尔用，须按具体值过滤`;
  }
  return undefined;
}

/**
 * 把 fields.json 字段定义 + PolicyFact 真实 schema 合成可查真值视图。
 * @param fields           fields.json 字段定义
 * @param describeColumns  DESCRIBE PolicyFact 结果；null 表示 schema 暂不可用（不阻断端点）
 * @param opts.verbose     是否附带 ETL 入库元数据（ingestTypes / ingestAliases）
 */
export function buildFieldsView(
  fields: FieldsJsonEntry[],
  describeColumns: DescribeColumn[] | null,
  opts: { verbose?: boolean } = {},
): FieldView[] {
  const colMap = describeColumns ? new Map(describeColumns.map((c) => [c.name, c.type])) : null;

  return fields.map((field) => {
    const derived = Boolean(field.derived);
    const sensitive = Boolean(field.sensitive);

    let queryable: boolean | null;
    let actualType: string | null;
    if (sensitive) {
      // 敏感字段（个人信息）：即便物理列存在也不对分析查询面暴露可查性，
      // 与 sql-validator 的 SENSITIVE_FIELDS 拒绝口径保持一致（隐私红线）
      queryable = false;
      actualType = null;
    } else if (colMap === null) {
      queryable = null;
      actualType = null;
    } else if (colMap.has(field.id)) {
      queryable = true;
      actualType = colMap.get(field.id) ?? null;
    } else {
      queryable = false;
      actualType = null;
    }

    const groupable = sensitive
      ? false
      : actualType !== null ? typeIsGroupable(actualType) : declaredGroupable(field.dataTypes);

    const note = sensitive
      ? '敏感字段（个人信息）：分析查询面禁止 SELECT / GROUP BY / ORDER BY，仅限授权台账同步场景'
      : computeNote(field, derived, queryable, actualType);

    const view: FieldView = {
      column: field.id,
      id: field.id,
      label: field.label,
      queryable,
      actualType,
      groupable,
      derived,
      ...(note ? { note } : {}),
      description: field.description ?? '',
    };

    if (opts.verbose) {
      view.ingestTypes = field.dataTypes;
      view.ingestAliases = field.aliases;
    }

    return view;
  });
}
