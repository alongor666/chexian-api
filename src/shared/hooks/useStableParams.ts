/**
 * 引用稳定化 Hook（治理计划 Task 1-B，评审 🟡3）
 *
 * 适用：buildFilterParams 一类平坦 Record 产物。黑名单式全量透传（`...filters` + 剥离）
 * 让 useMemo 依赖整个 filters 引用——被剥离字段（如全局日期）变化也会产出新对象；
 * 值相同时返回旧引用，避免依赖该产物的 useEffect 重复请求。
 */
import { useRef } from 'react';

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  if (a === b) return true;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

/** 值相等（浅比较）时返回旧引用，保证「参数值不变 ⇒ 引用不变」 */
export function useStableParams<T extends Record<string, unknown>>(value: T): T {
  const ref = useRef(value);
  if (!shallowEqual(ref.current, value)) {
    ref.current = value;
  }
  return ref.current;
}
