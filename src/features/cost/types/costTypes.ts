/**
 * 成本分析类型定义（barrel 入口）
 * Cost Analysis Type Definitions
 *
 * 该文件已拆分为 7 个子领域，下游 import 路径保持不变：
 *   - dimensions.ts            维度 / 子 Tab
 *   - earned-premium-basic.ts  已赚保费基础选项与筛选
 *   - cost-data.ts             核心数据接口（赔付率/费用率/综合/变动/已赚保费）
 *   - hook-results.ts          Hook 结果 + 控制面板 Props
 *   - table-columns.ts         表格列配置类型与 6 个 *_COLUMNS 常量
 *   - new-earned-premium.ts    新口径已赚保费（V3 + V2 + 滚动 12 月）
 *   - expense-forecast.ts      综合费用率预测
 */

export * from './dimensions';
export * from './earned-premium-basic';
export * from './cost-data';
export * from './hook-results';
export * from './table-columns';
export * from './new-earned-premium';
export * from './expense-forecast';
