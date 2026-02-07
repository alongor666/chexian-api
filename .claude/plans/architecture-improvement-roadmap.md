# 车险业绩看板系统 - 架构改进路线图（极简版）

**创建时间**: 2026-02-04
**更新时间**: 2026-02-04（根据 Staff Engineer 审查修订）
**计划类型**: 安全加固 → 观察验证
**预计周期**: 2 周（核心安全）+ 持续观察
**优先级**: P0（必须做）

---

## Staff Engineer 审查结论

**原计划问题**：
1. 过度工程化（30+文件改动、6个月周期）
2. 假设未验证（JWT风险、组件复杂度、测试需求）
3. 范围蔓延（必须做和nice-to-have混在一起）

**修订方向**：
- 文件数：30+ → 5 (6x简化)
- 周期：6个月 → 2周 (12x加速)
- 复杂度：高 → 低 (可控)

---

## 实施状态

### ✅ 已完成任务

| 任务 | 文件 | 状态 | 完成时间 |
|------|------|------|----------|
| 后端权限WHERE条件 | `server/src/middleware/permission.ts` | ✅ 已存在 | - |
| 权限服务层 | `server/src/services/permission.ts` | ✅ 已存在 | - |
| SQL权限注入工具 | `server/src/utils/sql-permission-injector.ts` | ✅ 已存在 | - |
| 路由权限中间件应用 | `server/src/routes/query.ts` | ✅ 已存在 | - |
| ErrorBoundary组件 | `src/components/layout/ErrorBoundary.tsx` | ✅ 已存在 | - |
| LazyRoute + ErrorBoundary集成 | `src/app/App.tsx` | ✅ 已存在 | - |
| 关键路径测试 | `tests/integration/critical-path.test.ts` | ✅ 新建 | 2026-02-04 |

### 🔄 观察验证阶段

**监控项**：
- [ ] API日志：是否有未授权访问尝试
- [ ] 错误率：ErrorBoundary触发次数
- [ ] 用户反馈：是否遇到权限或白屏问题

---

## 极简版计划详情

### Week 1：验证现有实现（已完成）

| 检查项 | 结果 | 备注 |
|--------|------|------|
| 后端权限过滤 | ✅ 完整 | permissionMiddleware + permissionService |
| SQL注入防护 | ✅ 完整 | sql-sanitizer + sql-permission-injector |
| ErrorBoundary | ✅ 完整 | 已集成到所有lazy-loaded路由 |
| 安全测试 | ✅ 完整 | tests/security.test.ts (80+用例) |
| 关键路径测试 | ✅ 新建 | tests/integration/critical-path.test.ts (30用例) |

### Week 2：观察与调整

**日常检查**：
```bash
# 运行关键路径测试
bun test tests/integration/critical-path.test.ts

# 运行安全测试
bun test tests/security.test.ts

# 运行完整测试套件
bun test
```

**监控指标**：
- API 401/403 响应比例
- ErrorBoundary 触发日志
- 用户报告的权限问题

---

## 暂缓任务（待验证后决定）

| 任务 | 原计划 | 触发条件 | 当前状态 |
|------|--------|----------|----------|
| JWT改HttpOnly | Phase 1.2 | 发现XSS漏洞 | ❌ 暂缓 |
| Dashboard组件拆分 | Phase 2.1 | 组件修改频率>2次/月 | ❌ 暂缓 |
| useDashboardData拆分 | Phase 2.2 | Hook修改频率>2次/月 | ❌ 暂缓 |
| 后端三层架构 | Phase 2.4 | API数量>50 | ❌ 删除 |
| 统一配置中心 | Phase 3.1 | 部署环境>3个 | ❌ 暂缓 |
| Swagger文档 | Phase 3.2 | 外部开发者接入需求 | ❌ 暂缓 |
| 性能监控 | Phase 3.3 | 性能问题报告 | ❌ 暂缓 |

---

## 回滚策略

| 功能 | 回滚方法 | 影响 |
|------|----------|------|
| 后端权限过滤 | `git revert` 删除WHERE条件注入 | 临时降级到无RLS |
| ErrorBoundary | 从App.tsx移除ErrorBoundary包裹 | 组件错误导致白屏 |
| 关键路径测试 | `rm tests/integration/critical-path.test.ts` | 无功能影响 |

---

## 关键文件清单（当前状态）

### 安全相关（已实现）

```
server/src/middleware/permission.ts     # 权限中间件
server/src/services/permission.ts       # 权限服务
server/src/utils/sql-permission-injector.ts  # SQL权限注入
server/src/utils/sql-sanitizer.ts       # SQL参数安全处理
server/src/routes/query.ts              # 查询路由（已应用权限中间件）
```

### 错误处理（已实现）

```
src/components/layout/ErrorBoundary.tsx  # 错误边界组件
src/app/App.tsx                          # LazyRoute + ErrorBoundary集成
```

### 测试覆盖（已实现）

```
tests/security.test.ts                   # 安全测试（80+用例）
tests/api/client.test.ts                 # API客户端测试
tests/integration/critical-path.test.ts  # 关键路径测试（30用例）
```

---

## 验证清单

### 安全验证

```bash
# 1. 权限过滤测试
bun test tests/integration/critical-path.test.ts
# 预期：30 pass, 0 fail

# 2. SQL注入防护测试
bun test tests/security.test.ts
# 预期：全部通过

# 3. 完整测试套件
bun test
# 预期：593 pass (或更多)
```

### 功能验证

```
- [ ] 分公司管理员可查看所有数据
- [ ] 机构用户只能查看本机构数据
- [ ] 组件错误显示友好页面（非白屏）
- [ ] 刷新按钮可恢复
```

---

## 决策记录

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-02-04 | 删除后端三层架构任务 | 13个API端点无需三层，过度工程化 |
| 2026-02-04 | 暂缓JWT改HttpOnly | 无XSS漏洞证据，避免强制登出 |
| 2026-02-04 | 暂缓组件拆分 | 修改频率未验证，当前可维护 |
| 2026-02-04 | 修改测试目标为关键路径覆盖 | 80%覆盖率不等于质量 |

---

## 下一步行动

### 本周（Week 1）
- [x] 验证后端权限过滤完整性
- [x] 验证ErrorBoundary集成完整性
- [x] 创建关键路径测试

### 下周（Week 2）
- [ ] 监控API日志（未授权访问尝试）
- [ ] 监控ErrorBoundary触发次数
- [ ] 收集用户反馈

### 长期（按需）
- [ ] 根据监控数据决定是否启动暂缓任务
- [ ] 每月检查触发条件

---

**计划状态**: ✅ 已完成核心实施，进入观察阶段
**下次更新**: Week 2 观察结果
**负责人**: 技术团队
