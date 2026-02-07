# 2026-01-06 Parquet 混合数据架构决策

## 背景
现有系统处理的数据文件规模差异巨大：
1. **主数据文件**：如 `业务员车险签单清单` (10w+ 行)、`各机构车险签单报表` (5w+ 行)。使用 XLSX/CSV 在浏览器端全量解析会导致：
   - 解析时间长（阻塞 UI 或 Worker 通信开销大）
   - 内存占用高（Row-based 存储对象开销）
2. **辅助数据文件**：如年度计划、配置表。数据量小 (<1w 行)，经常需要人工编辑。

## 决策：混合数据架构
采用 **Parquet + XLSX** 的混合模式：

| 数据类型 | 文件示例 | 存储格式 | 前端解析方案 | 优势 |
|:---|:---|:---|:---|:---|
| **大数据/明细表** | 业务员清单、机构报表 | **Parquet** | `parquet-wasm` | 高压缩率、列式读取性能高、强类型 |
| **小数据/配置表** | 年度计划、维度映射 | **XLSX/CSV** | `xlsx` / `papaparse` | 方便人工编辑、无需转换步骤 |

## 技术实现

### 1. 数据预处理 (ETL)
提供 Node.js 脚本 `scripts/xlsx2parquet.ts`，供管理员或 CI/CD 流程使用。
- 输入：原始 Excel 导出文件
- 输出：.parquet 文件（Snappy 压缩）
- 逻辑：自动推断类型或基于 `src/types/data.types.ts` 强制类型转换。

### 2. 前端集成
- **依赖**：`parquet-wasm`
- **构建配置**：需配置 `vite-plugin-wasm` 和 `top-level-await` 以支持 WebAssembly。
- **服务层**：`DataService` 根据文件扩展名选择策略。
  - `.parquet`: 调用 WASM 读取
  - `.xlsx/.csv`: 维持现有逻辑

## 预期收益
- **加载速度**：Parquet 文件体积预计只有 CSV 的 1/5 - 1/10，网络传输和加载速度显著提升。
- **内存优化**：WASM 堆内存管理优于 JS 对象大量创建。
- **查询能力**：未来可支持只读取特定列（Projection），进一步减少开销。

## 后续规划
- 结合 #2.7 Supabase 集成：Supabase Storage 可存储 Parquet 文件，或利用 DuckDB-WASM 直接对 Parquet 进行 SQL 查询。
