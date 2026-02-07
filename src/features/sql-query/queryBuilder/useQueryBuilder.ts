/**
 * 查询构建器状态管理 Hook
 */

import { useReducer, useCallback, useMemo } from 'react';
import type {
  QueryBuilderState,
  QueryBuilderAction,
  SelectedMeasure,
  FilterCondition,
  SortConfig,
} from './types';
import { generateSqlFromBuilder, validateQueryBuilderState } from './sqlGenerator';
import { getFieldDefinition, PRESET_MEASURES } from './fieldConfig';

/**
 * 初始状态
 */
const initialState: QueryBuilderState = {
  dimensions: [],
  measures: [],
  filters: [],
  orderBy: null,
  limit: 1000,
};

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 状态 Reducer
 */
function queryBuilderReducer(
  state: QueryBuilderState,
  action: QueryBuilderAction
): QueryBuilderState {
  switch (action.type) {
    case 'ADD_DIMENSION': {
      // 检查是否已存在
      if (state.dimensions.some((d) => d.field === action.field)) {
        return state;
      }
      return {
        ...state,
        dimensions: [...state.dimensions, { field: action.field }],
      };
    }

    case 'REMOVE_DIMENSION': {
      return {
        ...state,
        dimensions: state.dimensions.filter((d) => d.field !== action.field),
        // 如果排序字段被移除，清除排序
        orderBy:
          state.orderBy?.field === action.field ? null : state.orderBy,
      };
    }

    case 'ADD_MEASURE': {
      // 检查别名是否已存在
      if (state.measures.some((m) => m.alias === action.measure.alias)) {
        // 生成新别名
        const baseAlias = action.measure.alias;
        let counter = 2;
        let newAlias = `${baseAlias}_${counter}`;
        while (state.measures.some((m) => m.alias === newAlias)) {
          counter++;
          newAlias = `${baseAlias}_${counter}`;
        }
        return {
          ...state,
          measures: [...state.measures, { ...action.measure, alias: newAlias }],
        };
      }
      return {
        ...state,
        measures: [...state.measures, action.measure],
      };
    }

    case 'REMOVE_MEASURE': {
      return {
        ...state,
        measures: state.measures.filter((m) => m.alias !== action.alias),
        // 如果排序字段被移除，清除排序
        orderBy:
          state.orderBy?.field === action.alias ? null : state.orderBy,
      };
    }

    case 'ADD_FILTER': {
      return {
        ...state,
        filters: [...state.filters, action.filter],
      };
    }

    case 'UPDATE_FILTER': {
      return {
        ...state,
        filters: state.filters.map((f) =>
          f.id === action.id ? { ...f, ...action.updates } : f
        ),
      };
    }

    case 'REMOVE_FILTER': {
      return {
        ...state,
        filters: state.filters.filter((f) => f.id !== action.id),
      };
    }

    case 'SET_ORDER_BY': {
      return {
        ...state,
        orderBy: action.orderBy,
      };
    }

    case 'SET_LIMIT': {
      return {
        ...state,
        limit: Math.max(1, Math.min(10000, action.limit)),
      };
    }

    case 'RESET': {
      return initialState;
    }

    case 'LOAD_STATE': {
      return action.state;
    }

    default:
      return state;
  }
}

/**
 * 查询构建器 Hook
 */
export function useQueryBuilder() {
  const [state, dispatch] = useReducer(queryBuilderReducer, initialState);

  // 添加维度
  const addDimension = useCallback((field: string) => {
    dispatch({ type: 'ADD_DIMENSION', field });
  }, []);

  // 移除维度
  const removeDimension = useCallback((field: string) => {
    dispatch({ type: 'REMOVE_DIMENSION', field });
  }, []);

  // 添加度量
  const addMeasure = useCallback((measure: SelectedMeasure) => {
    dispatch({ type: 'ADD_MEASURE', measure });
  }, []);

  // 从预设添加度量
  const addPresetMeasure = useCallback((presetId: string) => {
    const preset = PRESET_MEASURES.find((p) => p.id === presetId);
    if (preset) {
      const measure: SelectedMeasure = {
        field: preset.field,
        aggregate: preset.aggregate,
        alias: preset.alias,
      };
      dispatch({ type: 'ADD_MEASURE', measure });
    }
  }, []);

  // 移除度量
  const removeMeasure = useCallback((alias: string) => {
    dispatch({ type: 'REMOVE_MEASURE', alias });
  }, []);

  // 添加筛选条件
  const addFilter = useCallback((field: string) => {
    const filter: FilterCondition = {
      id: generateId(),
      field,
      operator: '=',
      value: null,
    };
    dispatch({ type: 'ADD_FILTER', filter });
  }, []);

  // 更新筛选条件
  const updateFilter = useCallback(
    (id: string, updates: Partial<FilterCondition>) => {
      dispatch({ type: 'UPDATE_FILTER', id, updates });
    },
    []
  );

  // 移除筛选条件
  const removeFilter = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_FILTER', id });
  }, []);

  // 设置排序
  const setOrderBy = useCallback((orderBy: SortConfig | null) => {
    dispatch({ type: 'SET_ORDER_BY', orderBy });
  }, []);

  // 设置限制
  const setLimit = useCallback((limit: number) => {
    dispatch({ type: 'SET_LIMIT', limit });
  }, []);

  // 重置
  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  // 加载状态
  const loadState = useCallback((newState: QueryBuilderState) => {
    dispatch({ type: 'LOAD_STATE', state: newState });
  }, []);

  // 生成 SQL
  const generatedSql = useMemo(() => {
    return generateSqlFromBuilder(state);
  }, [state]);

  // 验证状态
  const validation = useMemo(() => {
    return validateQueryBuilderState(state);
  }, [state]);

  // 可用的排序字段
  const sortableFields = useMemo(() => {
    const fields: Array<{ value: string; label: string }> = [];
    // 添加维度
    for (const dim of state.dimensions) {
      const dimFieldDef = getFieldDefinition(dim.field);
      fields.push({
        value: dim.field,
        label: dimFieldDef?.label || dim.field,
      });
    }
    // 添加度量
    for (const measure of state.measures) {
      fields.push({
        value: measure.alias,
        label: measure.alias,
      });
    }
    return fields;
  }, [state.dimensions, state.measures]);

  return {
    state,
    // 维度操作
    addDimension,
    removeDimension,
    // 度量操作
    addMeasure,
    addPresetMeasure,
    removeMeasure,
    // 筛选操作
    addFilter,
    updateFilter,
    removeFilter,
    // 排序和限制
    setOrderBy,
    setLimit,
    // 其他
    reset,
    loadState,
    // 计算值
    generatedSql,
    validation,
    sortableFields,
  };
}
