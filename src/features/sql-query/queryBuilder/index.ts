/**
 * SQL 查询构建器模块
 *
 * 提供可视化的拖拽式查询构建功能
 */

// 类型导出
export type {
  FieldType,
  DataType,
  AggregateFunction,
  FilterOperator,
  SortDirection,
  FieldDefinition,
  SelectedDimension,
  SelectedMeasure,
  FilterCondition,
  SortConfig,
  QueryBuilderState,
  PresetMeasure,
  QueryBuilderAction,
} from './types';

// 配置导出
export {
  DIMENSION_FIELDS,
  MEASURE_FIELDS,
  PRESET_MEASURES,
  ALL_FIELDS,
  getFieldDefinition,
  getDimensionsByGroup,
  GROUP_ORDER,
  FILTER_OPERATORS,
} from './fieldConfig';

// SQL 生成器导出
export {
  generateSqlFromBuilder,
  generatePreviewSql,
  generateDistinctValuesSql,
  generateCountPreviewSql,
  validateQueryBuilderState,
} from './sqlGenerator';

// Hook 导出
export { useQueryBuilder } from './useQueryBuilder';

// 组件导出
export { DimensionSelector } from './DimensionSelector';
export { MeasureSelector } from './MeasureSelector';
export { FilterBuilder } from './FilterBuilder';
export { QueryBuilderPanel } from './QueryBuilderPanel';
