#!/usr/bin/env node
/**
 * 字段注册表 codegen — 从 fields.json 单一事实源生成 4 个下游文件
 *
 * 生成目标：
 *   1. server/src/normalize/mapping.ts      → DomainField / COLUMN_ALIASES / OPTIONAL_FIELDS / ColumnMapping / DEFAULT_MAPPING
 *   2. server/src/normalize/validator.ts     → EXPECTED_TYPES（仅替换 Record 部分）
 *   3. 数据管理/pipelines/etl_fields.json   → core_fields / optional_fields（供 transform.py 读取）
 *   4. stdout: 字段摘要统计
 *
 * 用法：
 *   node scripts/field-registry/generate.mjs           # 生成所有下游
 *   node scripts/field-registry/generate.mjs --check    # 只校验不写入（governance 用）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

const REGISTRY_PATH = path.join(ROOT, 'server/src/config/field-registry/fields.json');
const MAPPING_PATH = path.join(ROOT, 'server/src/normalize/mapping.ts');
const VALIDATOR_PATH = path.join(ROOT, 'server/src/normalize/validator.ts');
const ETL_FIELDS_PATH = path.join(ROOT, '数据管理/pipelines/etl_fields.json');

const checkOnly = process.argv.includes('--check');

// ── 加载注册表 ──
const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
const fields = registry.fields;
const required = fields.filter(f => f.required);
const optional = fields.filter(f => !f.required);

console.log(`📋 字段注册表: ${fields.length} 个字段 (${required.length} 必需 + ${optional.length} 可选)`);

// ── 1. 生成 mapping.ts ──
function generateMapping() {
  const domainFieldType = fields.map(f => `  | '${f.id}'`).join('\n');

  const aliasEntries = fields.map(f => {
    const aliases = f.aliases.map(a => `'${a}'`).join(', ');
    return `  ${f.id}: [${aliases}],`;
  }).join('\n');

  const optionalFieldEntries = optional.map(f => `  '${f.id}',`).join('\n');

  const columnMappingEntries = fields.map(f => {
    const opt = f.required ? '' : '?';
    return `  ${f.id}${opt}: string; // ${f.label}`;
  }).join('\n');

  const defaultMappingEntries = fields.map(f =>
    `  ${f.id}: '${f.id}',`
  ).join('\n');

  const content = `/**
 * Column Mapping with Alias Support
 *
 * ⚠️ AUTO-GENERATED from field-registry/fields.json — DO NOT EDIT MANUALLY
 * Run: node scripts/field-registry/generate.mjs
 */

export type DomainField =
${domainFieldType};

export interface ColumnAliasConfig {
  [key: string]: string[];
}

export const COLUMN_ALIASES: ColumnAliasConfig = {
${aliasEntries}
};

export const OPTIONAL_FIELDS: Set<DomainField> = new Set([
${optionalFieldEntries}
]);

export interface ColumnMapping {
${columnMappingEntries}
}

export interface ValidationResult {
  valid: boolean;
  mapping?: ColumnMapping;
  errors: string[];
  warnings: string[];
}

export function validateAndResolveMapping(
  actualColumns: string[],
  aliases: ColumnAliasConfig = COLUMN_ALIASES
): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  const columnSet = new Set(actualColumns);
  const resolvedMapping: Partial<ColumnMapping> = {};

  for (const domainField of Object.keys(aliases) as DomainField[]) {
    const possibleNames = aliases[domainField];
    const isOptional = OPTIONAL_FIELDS.has(domainField);
    let resolved = false;

    for (const candidateName of possibleNames) {
      if (columnSet.has(candidateName)) {
        if (resolved) {
          result.warnings.push(
            \`Domain field "\${domainField}" has multiple matches: already resolved to "\${resolvedMapping[domainField]}", but also found "\${candidateName}"\`
          );
        } else {
          resolvedMapping[domainField] = candidateName;
          resolved = true;
        }
      }
    }

    if (!resolved && !isOptional) {
      result.valid = false;
      result.errors.push(
        \`Required domain field "\${domainField}" not found. Expected one of: \${possibleNames.join(', ')}\`
      );
    }
  }

  if (result.valid) {
    result.mapping = resolvedMapping as ColumnMapping;
  }

  return result;
}

export const DEFAULT_MAPPING: ColumnMapping = {
${defaultMappingEntries}
};
`;
  return content;
}

// ── 2. 生成 validator.ts EXPECTED_TYPES ──
function generateValidator() {
  const typeEntries = fields.map(f => {
    const types = f.dataTypes.map(t => `'${t}'`).join(', ');
    return `  ${f.id}: [${types}], // ${f.label}`;
  }).join('\n');

  const content = `/**
 * Data Validation Utilities
 *
 * ⚠️ EXPECTED_TYPES is AUTO-GENERATED from field-registry/fields.json — DO NOT EDIT MANUALLY
 * Run: node scripts/field-registry/generate.mjs
 */

import { ColumnMapping } from './mapping.js';
import { createLogger } from '../utils/logger.js';
import type { QueryResultRow } from '../types/data.js';

const logger = createLogger('Validator');

export const EXPECTED_TYPES: Record<keyof ColumnMapping, string[]> = {
${typeEntries}
};

export interface SchemaColumn {
  column_name: string;
  column_type: string;
}

export interface TypeValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateColumnTypes(
  schema: SchemaColumn[],
  mapping: ColumnMapping
): TypeValidationResult {
  const result: TypeValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  const schemaMap = new Map(schema.map((col) => [col.column_name, col.column_type.toUpperCase()]));

  for (const [domainField, actualColumn] of Object.entries(mapping) as [
    keyof ColumnMapping,
    string
  ][]) {
    const actualType = schemaMap.get(actualColumn);
    const expectedTypes = EXPECTED_TYPES[domainField];

    if (!actualType) {
      result.warnings.push(
        \`Column "\${actualColumn}" (domain: \${domainField}) not found in schema\`
      );
      continue;
    }

    if (expectedTypes && !expectedTypes.some((t) => actualType.includes(t))) {
      result.warnings.push(
        \`Column "\${actualColumn}" (domain: \${domainField}) has type \${actualType}, expected one of: \${expectedTypes.join(', ')}\`
      );
    }
  }

  return result;
}

export function validateDataQuality(
  rows: QueryResultRow[],
  mapping: ColumnMapping
): { warnings: string[] } {
  const warnings = [];
  if (rows.length === 0) {
    warnings.push('No data rows to validate');
    return { warnings };
  }

  const sampleSize = Math.min(100, rows.length);
  const sample = rows.slice(0, sampleSize);

  const premiumCol = mapping.premium;
  if (premiumCol) {
    const nullPremiums = sample.filter(
      (r) => r[premiumCol] === null || r[premiumCol] === undefined
    ).length;
    if (nullPremiums > sampleSize * 0.1) {
      warnings.push(
        \`High null rate in premium column: \${nullPremiums}/\${sampleSize} (\${((nullPremiums / sampleSize) * 100).toFixed(1)}%)\`
      );
    }
  }

  return { warnings };
}
`;
  return content;
}

// ── 3. 生成 etl_fields.json（供 transform.py 读取）──
function generateEtlFields() {
  // cn_to_en_mapping: sourceColumn(源Excel中文列名) → id(英文 snake_case Parquet 列名) 的一对一映射
  // 注意：只用 sourceColumn，不用 aliases，避免 DataFrame 出现重名列
  const cnToEn = {};
  for (const f of fields) {
    cnToEn[f.sourceColumn] = f.id;
  }

  return JSON.stringify({
    _doc: "⚠️ AUTO-GENERATED from field-registry/fields.json — DO NOT EDIT",
    core_fields: registry.etl.coreSourceColumns,
    optional_fields: registry.etl.optionalSourceColumns,
    cn_to_en_mapping: cnToEn,
  }, null, 2) + '\n';
}

// ── 执行 ──
const targets = [
  { path: MAPPING_PATH, generate: generateMapping, name: 'mapping.ts' },
  { path: VALIDATOR_PATH, generate: generateValidator, name: 'validator.ts' },
  { path: ETL_FIELDS_PATH, generate: generateEtlFields, name: 'etl_fields.json' },
];

let allInSync = true;

for (const target of targets) {
  const generated = target.generate();
  const existing = fs.existsSync(target.path) ? fs.readFileSync(target.path, 'utf-8') : '';

  if (generated === existing) {
    console.log(`  ✅ ${target.name} — 已同步`);
  } else if (checkOnly) {
    console.log(`  ❌ ${target.name} — 与注册表不同步，运行 node scripts/field-registry/generate.mjs`);
    allInSync = false;
  } else {
    fs.writeFileSync(target.path, generated);
    console.log(`  📝 ${target.name} — 已更新`);
  }
}

if (checkOnly && !allInSync) {
  process.exit(1);
}

if (!checkOnly) {
  console.log(`\n✅ codegen 完成: ${targets.length} 个文件已从 fields.json 生成`);
}
