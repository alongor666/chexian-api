/**
 * 指标注册表校验器
 *
 * 检查项：
 * 1. ID 格式（snake_case）
 * 2. 必填字段完整性
 * 3. SQL 表达式包含 AS alias
 * 4. 至少 1 个 testCase
 * 5. changelog 非空
 * 6. version 格式（semver）
 */

import type { MetricDefinition } from './types.js';
import { getAllMetrics, getRegistryStats } from './index.js';

interface ValidationError {
  readonly metricId: string;
  readonly field: string;
  readonly message: string;
}

const SNAKE_CASE_RE = /^[a-z][a-z0-9_]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

export function validateRegistry(): {
  errors: readonly ValidationError[];
  warnings: readonly ValidationError[];
  stats: ReturnType<typeof getRegistryStats>;
} {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const metrics = getAllMetrics();

  for (const m of metrics) {
    // ID 格式
    if (!SNAKE_CASE_RE.test(m.id)) {
      errors.push({ metricId: m.id, field: 'id', message: `ID 不符合 snake_case 格式: "${m.id}"` });
    }

    // version 格式
    if (!SEMVER_RE.test(m.version)) {
      errors.push({ metricId: m.id, field: 'version', message: `版本号不符合 semver: "${m.version}"` });
    }

    // 必填字段
    if (!m.name.trim()) {
      errors.push({ metricId: m.id, field: 'name', message: '名称不能为空' });
    }
    if (!m.formula.description.trim()) {
      errors.push({ metricId: m.id, field: 'formula.description', message: '公式描述不能为空' });
    }
    if (!m.formula.unit.trim()) {
      errors.push({ metricId: m.id, field: 'formula.unit', message: '单位不能为空' });
    }

    // SQL 表达式
    if (!m.sql.expression.trim()) {
      errors.push({ metricId: m.id, field: 'sql.expression', message: 'SQL 表达式不能为空' });
    } else if (!/\bAS\b/i.test(m.sql.expression)) {
      warnings.push({ metricId: m.id, field: 'sql.expression', message: 'SQL 表达式缺少 AS alias' });
    }

    // requiredColumns
    if (m.sql.requiredColumns.length === 0) {
      warnings.push({ metricId: m.id, field: 'sql.requiredColumns', message: '依赖字段列表为空' });
    }

    // display
    if (!m.display.label.trim()) {
      errors.push({ metricId: m.id, field: 'display.label', message: '展示标签不能为空' });
    }

    // testCases
    if (m.testCases.length === 0) {
      errors.push({ metricId: m.id, field: 'testCases', message: '至少需要 1 个测试用例' });
    }

    // changelog
    if (m.changelog.length === 0) {
      errors.push({ metricId: m.id, field: 'changelog', message: '变更历史不能为空' });
    }

    // thresholds 单调性（可选字段）
    if (m.thresholds) {
      const { direction, notice, warn, danger } = m.thresholds;
      if (direction === 'higher_worse') {
        if (!(notice < warn && warn < danger)) {
          errors.push({
            metricId: m.id,
            field: 'thresholds',
            message: `higher_worse 要求 notice < warn < danger，实际 (${notice}, ${warn}, ${danger})`,
          });
        }
      } else if (direction === 'lower_worse') {
        if (!(notice > warn && warn > danger)) {
          errors.push({
            metricId: m.id,
            field: 'thresholds',
            message: `lower_worse 要求 notice > warn > danger，实际 (${notice}, ${warn}, ${danger})`,
          });
        }
      }
    }
  }

  return {
    errors,
    warnings,
    stats: getRegistryStats(),
  };
}

/** 校验并输出报告，返回是否通过 */
export function validateAndReport(): boolean {
  const { errors, warnings, stats } = validateRegistry();

  console.log('=== 指标注册表校验报告 ===\n');
  console.log(`总计: ${stats.total} 个指标`);
  console.log('按分类:');
  for (const [cat, count] of Object.entries(stats.byCategory)) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log('');

  if (warnings.length > 0) {
    console.log(`⚠ 警告 (${warnings.length}):`);
    for (const w of warnings) {
      console.log(`  [${w.metricId}] ${w.field}: ${w.message}`);
    }
    console.log('');
  }

  if (errors.length > 0) {
    console.log(`✗ 错误 (${errors.length}):`);
    for (const e of errors) {
      console.log(`  [${e.metricId}] ${e.field}: ${e.message}`);
    }
    console.log('');
    return false;
  }

  console.log('✓ 校验通过\n');
  return true;
}
