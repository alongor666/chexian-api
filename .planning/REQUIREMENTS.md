# Requirements: chexian-api 全栈性能架构重构

**Defined:** 2026-04-12
**Core Value:** 让用户在任何页面都能获得亚秒级的数据响应体验 — 从当前全站 2-5 秒降至 <500ms

## v1 Requirements

### Security (安全修复)

- [ ] **SEC-01**: 快照 scope 碰撞修复 — permissionToScope 对 unknown 权限改为 next() 回退，不同权限用户不共享快照文件
- [ ] **SEC-02**: 权限隔离 E2E 测试 — 自动化验证不同角色用户访问相同端点返回不同结果，快照层不泄漏

### SQL Query Optimization (SQL 查询优化)

- [ ] **SQL-01**: 黄金快照回归基线 — 在任何 SQL 重构前，对所有核心 API 端点建立返回值快照，后续重构后逐一比对确保结果一致
- [ ] **SQL-02**: coefficient.ts UNION ALL → CTE 窗口函数 — 6路 UNION ALL 合并为单次表扫描，查询时间从 2-5s 降至 <500ms
- [ ] **SQL-03**: earned-premium-detail.ts EXPLAIN ANALYZE 验证 — 12月查询是否适合 CTE 合并需运行时数据决定，不盲目改写
- [ ] **SQL-04**: SQL 生成器模块拆分 — trend.ts(561行) 和 performance-analysis-shared.ts(545行) 拆为子目录模式（复用 sql/cost/ 先例）

### Frontend Bundle (前端包体优化)

- [ ] **FE-01**: Bundle 基线测量 — 安装 rollup-plugin-visualizer，运行后确认各 chunk 大小，建立优化前基线
- [ ] **FE-02**: 压缩插件替换 — vite-plugin-compression 0.5.1（停更4年）→ vite-plugin-compression2 2.4.0
- [ ] **FE-03**: ECharts 懒加载验证 — 确认 ECharts chunk 是否真正按需加载，首屏不加载图表库
- [ ] **FE-04**: FilterContext 拆分 — 稳定状态（用户信息/权限）与易变状态（筛选条件）分离，减少无效重渲染

### Data Materialization (数据物化优化)

- [ ] **MAT-01**: 次要表惰性物化 — ClaimsDetail/CrossSellFact/CustomerFlow/RenewalUniverse 延迟到首次请求时物化，PolicyFact 保持 eager
- [ ] **MAT-02**: duckdb.ts 关注点拆分 — 662行混合模块拆为 ConnectionPool、QueryCache、DomainLoader、TypeConverter 独立模块
- [ ] **MAT-03**: 持久化暖启动 — 利用 .duckdb 持久化文件 + Parquet 指纹缓存，PM2 重启从 90s 降至 <10s
- [ ] **MAT-04**: 快照分域失效 — 静态 Parquet（2021-2023）与动态 Parquet（当年）独立指纹，ETL 增量更新不触发全量重算

## v2 Requirements

### Monitoring (可观测性)

- **MON-01**: prom-client 监控端点 — /metrics 暴露查询延迟、内存使用、连接池状态
- **MON-02**: Parquet 月粒度分区 — 按月分区启用 DuckDB file pruning

### Code Quality (代码质量)

- **CQ-01**: DuckDB 类型转换器测试 — convertBigIntToNumber() 的 DATE/TIMESTAMP 转换覆盖
- **CQ-02**: SQL 参数化测试 — 100+ 筛选条件组合的回归测试

## Out of Scope

| Feature | Reason |
|---------|--------|
| VPS 硬件升级 | 先通过软件优化挖潜，硬件是最后手段 |
| 数据库迁移 (DuckDB → 其他) | DuckDB 适合当前分析场景，向量化 SIMD 有扩展空间 |
| GROUPING SETS | DuckDB 已知 bug 禁用列裁剪，宽表性能反而更差 |
| Redis 缓存层 | 过度工程化，快照+SW 已覆盖缓存需求 |
| 全量 React.memo | React 19 Compiler 自动处理 memoization |
| Redux 状态管理 | React Query + Context 已足够 |
| 8 域 ETL 拆分 (B239-B241) | 独立架构演进项目，不在本次重构范围 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 1 | Pending |
| SEC-02 | Phase 1 | Pending |
| SQL-01 | Phase 2 | Pending |
| SQL-02 | Phase 2 | Pending |
| SQL-03 | Phase 2 | Pending |
| SQL-04 | Phase 3 | Pending |
| FE-01 | Phase 3 | Pending |
| FE-02 | Phase 3 | Pending |
| FE-03 | Phase 3 | Pending |
| FE-04 | Phase 3 | Pending |
| MAT-01 | Phase 4 | Pending |
| MAT-02 | Phase 4 | Pending |
| MAT-03 | Phase 5 | Pending |
| MAT-04 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 14 total
- Mapped to phases: 14
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-12*
*Last updated: 2026-04-12 after initial definition*
