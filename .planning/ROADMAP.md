# Roadmap: chexian-api 全栈性能架构重构

## Overview

本次重构从三个热点做外科手术式收紧：先堵住快照层安全漏洞（Phase 1），再消灭 SQL 慢查询根因（Phase 2），同步整理代码结构和前端包体（Phase 3），最后分两步完成物化层优化（Phase 4）和持久化暖启动+快照失效精细化（Phase 5）。目标：全站响应从 2-5s 降至 <500ms，PM2 重启从 90s 降至 <10s。

## Phases

- [ ] **Phase 1: 安全基线** - 修复快照 scope 碰撞漏洞，建立权限隔离自动化验证
- [ ] **Phase 2: SQL 查询优化** - 建立黄金快照基线，重写 coefficient.ts 消灭 2-5s 慢查询
- [ ] **Phase 3: 代码结构整理** - SQL 生成器拆分 + 前端包体优化，可与 Phase 2 并行
- [ ] **Phase 4: 物化优化** - 次要表惰性物化 + duckdb.ts 关注点拆分
- [ ] **Phase 5: 持久化与快照精细化** - PM2 暖启动 <10s + 静态/动态 Parquet 独立失效

## Phase Details

### Phase 1: 安全基线
**Goal**: 不同权限用户访问相同端点，快照层严格隔离，不存在跨用户数据泄漏风险
**Depends on**: Nothing (first phase)
**Requirements**: SEC-01, SEC-02
**Success Criteria** (what must be TRUE):
  1. admin 用户和 leshan 用户请求同一端点（如 /api/query/kpi），响应头中 X-Snapshot 命中不同文件路径
  2. unknown/未认证权限请求不命中任何快照，正确回退到实时查询
  3. E2E 测试自动验证不同角色用户在同一端点返回不同数据集，且无法通过 scope 碰撞访问他人数据
**Plans:** 2 plans
Plans:
- [x] 01-01-PLAN.md — SEC-01 scope 碰撞修复（permissionToScope 返回 null + snapshotServe null 短路 + 单元测试）
- [x] 01-02-PLAN.md — SEC-02 权限隔离 E2E 测试（多角色快照隔离验证 + 人工端到端确认）

### Phase 2: SQL 查询优化
**Goal**: 所有核心 API 端点查询时间降至 <500ms，且 SQL 重构不引入任何结果回归
**Depends on**: Phase 1
**Requirements**: SQL-01, SQL-02, SQL-03
**Success Criteria** (what must be TRUE):
  1. 黄金快照基线建立完成：所有核心端点的 JSON 返回值已快照存档，可作为回归对比基准
  2. /api/query/coefficient 端点响应时间从 2-5s 降至 <500ms（benchmark 脚本可验证）
  3. coefficient.ts 重构后，与黄金快照对比无数值差异（每个字段误差 0）
  4. earned-premium-detail.ts 经 EXPLAIN ANALYZE 决策：若可合并则合并，若不可则有书面结论存档
**Plans**: TBD

### Phase 3: 代码结构整理
**Goal**: SQL 生成器大文件拆分完成，前端包体基线明确且压缩插件现代化，首屏不加载图表库
**Depends on**: Phase 1
**Requirements**: SQL-04, FE-01, FE-02, FE-03, FE-04
**Success Criteria** (what must be TRUE):
  1. trend.ts 和 performance-analysis-shared.ts 各自拆为子目录模式，单文件不超过 400 行
  2. rollup-plugin-visualizer 基线报告存档：各 chunk 大小可查，ECharts chunk 与主 bundle 分离确认
  3. vite-plugin-compression2 替换成功，bun run build 零警告，产物 brotli/gzip 压缩正常
  4. ECharts 确认按需加载：首屏网络瀑布中图表库 chunk 不在关键路径
  5. FilterContext 拆分后，筛选条件变更不触发用户信息/权限相关组件重渲染（React DevTools 可验证）
**Plans**: TBD
**UI hint**: yes

### Phase 4: 物化优化
**Goal**: 服务器启动内存基线从 ~70% 降至 ~50%，次要域首次请求延迟在可接受范围内
**Depends on**: Phase 2
**Requirements**: MAT-01, MAT-02
**Success Criteria** (what must be TRUE):
  1. PM2 启动后，仅 PolicyFact 完成 eager 物化，其余表（ClaimsDetail/CrossSellFact/CustomerFlow/RenewalUniverse）处于未加载状态
  2. 次要表首次请求触发物化时，API 正常返回（含合理加载提示），不出现连接池耗尽错误
  3. duckdb.ts 拆分为至少 ConnectionPool、QueryCache、DomainLoader、TypeConverter 四个独立模块，原文件不超过 100 行（仅做导出聚合）
  4. 内存占用监控：pm2 monit 显示稳态内存从 ~70% 降至 ~50%
**Plans**: TBD

### Phase 5: 持久化与快照精细化
**Goal**: PM2 重启后 <10s 完成 PolicyFact 可用，ETL 增量更新后只失效动态分区快照而非全量重算
**Depends on**: Phase 4
**Requirements**: MAT-03, MAT-04
**Success Criteria** (what must be TRUE):
  1. PM2 reload 后，/api/query/kpi 在 10s 内返回正常数据（本地计时可验证）
  2. 静态 Parquet（2021-2023）的快照指纹在 ETL 增量更新（仅更新当年数据）后不失效
  3. 动态 Parquet（当年）的快照在 ETL 更新后自动失效并在下次请求时重建
  4. bun run snapshot:verify 输出显示静态快照为 hit，动态快照重建后恢复为 hit
**Plans**: TBD

## Progress

**Execution Order:**
Phase 1 → Phase 2 → Phase 4 → Phase 5（顺序强制）
Phase 3 可与 Phase 2 并行（独立代码路径，无共享修改文件）

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. 安全基线 | 0/2 | Planning complete | - |
| 2. SQL 查询优化 | 0/TBD | Not started | - |
| 3. 代码结构整理 | 0/TBD | Not started | - |
| 4. 物化优化 | 0/TBD | Not started | - |
| 5. 持久化与快照精细化 | 0/TBD | Not started | - |
