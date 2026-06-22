/**
 * 权限管理纯逻辑
 *
 * 从 AccessControlPage 提取的与 React 无关的纯函数，便于直接单测：
 * - splitIpList：IP 白名单输入串 → 去空裁剪后的数组（支持中英文逗号 / 换行分隔）
 * - joinList：数组 → 逗号分隔展示串
 * - toggleSelection：复选框勾选/取消 → 不可变更新选中数组（路由组 / 特殊功能组共用）
 *
 * 行为与原组件内联实现逐字符一致。
 */

/** IP 白名单输入串 → 数组：按英文逗号 / 中文逗号 / 换行分隔，去空格、滤空项 */
export const splitIpList = (value: string): string[] =>
  value.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean);

/** 数组 → 逗号分隔展示串；空 / 缺省返回空串 */
export const joinList = (value?: string[]): string => {
  if (!value || value.length === 0) return '';
  return value.join(', ');
};

/**
 * 复选框切换 → 不可变更新选中数组
 * - checked=true：追加 item（保持原顺序）
 * - checked=false：移除全部等于 item 的项
 */
export const toggleSelection = (
  selected: string[],
  item: string,
  checked: boolean
): string[] => (checked ? [...selected, item] : selected.filter((x) => x !== item));
