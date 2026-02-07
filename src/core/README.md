# /src/core/ - 核心模块索引

> **说明**：本文件夹包含应用的核心架构模块，负责生命周期管理和事件通信。
>
> ⚠️ **架构变更说明（2026-02-04）**：
> - `StateManager.ts` 已废弃，状态管理已迁移至 `src/shared/contexts/FilterContext.tsx`
> - 数据服务已迁移至 DuckDB-WASM 客户端 (`src/shared/duckdb/`)

---

## 模块清单

### EventBus.ts - 事件总线
- **用途**: 实现发布-订阅模式的事件总线，解耦模块间通信
- **核心 API**:
  - `on(event, callback)` - 订阅事件
  - `off(event, callback)` - 取消订阅
  - `emit(event, data)` - 发布事件
- **依赖**: 无
- **被依赖**: App.ts, 各服务模块
- **状态**: ✅ 已完成
- **相关任务**: #1.5 创建核心模块骨架
- **相关文档**: /docs/architecture.md#事件总线

---

### App.ts - 应用协调器
- **用途**: 管理应用生命周期，协调各模块初始化和销毁
- **核心 API**:
  - `init()` - 初始化应用
  - `start()` - 启动应用
  - `destroy()` - 销毁应用
- **依赖**: EventBus.ts
- **被依赖**: /src/main.ts
- **状态**: ✅ 已完成
- **相关任务**: #1.5 创建核心模块骨架
- **相关文档**: /docs/architecture.md#应用协调器

---

## 已废弃模块（历史记录）

### ~~StateManager.ts~~ - 状态管理器（已删除）
- **废弃原因**: 已迁移至 React Context 架构
- **替代方案**: `src/shared/contexts/FilterContext.tsx`
- **删除日期**: 2026-02-04

---

## 模块关系图

```
main.ts
  └── App.ts (协调器)
        └── EventBus.ts (事件总线)

状态管理（新架构）:
  src/shared/contexts/
    ├── FilterContext.tsx (筛选状态)
    ├── DataContext.tsx (数据状态)
    └── PermissionContext.tsx (权限状态)
```

---

## 护栏规则

⚠️ **重要**：核心模块属于护栏保护范围，任何修改必须：
1. 在 `/BACKLOG.md` 登记任务
2. 在 `/PROGRESS.md` 记录变更详情
3. 同步更新 `/docs/00_index/CODE_INDEX.md`
4. 同步更新本文件（README.md）
5. 通过类型检查和 ESLint 验证

---

## 开发指南

### 新增核心模块
如需新增核心模块（如 Router.ts），请遵循以下步骤：
1. 在 `/BACKLOG.md` 登记任务
2. 创建模块文件 `/src/core/NewModule.ts`
3. 遵守 TypeScript 严格模式和 ESLint 规范
4. 更新本 README.md，添加模块条目
5. 更新 `/docs/00_index/CODE_INDEX.md`
6. 在 `/PROGRESS.md` 记录完成信息

### 修改现有模块
1. 查看 `/PROGRESS.md` 了解模块的历史变更
2. 在 `/BACKLOG.md` 登记任务
3. 进行修改，确保向后兼容
4. 更新相关文档和注释
5. 运行 `bun run type-check && bun run lint`
6. 更新本 README.md 的模块描述（如有必要）
7. 在 `/PROGRESS.md` 记录变更详情

---

## 质量检查

运行以下命令确保代码质量：
```bash
# 类型检查
bun run type-check

# 代码规范检查
bun run lint

# 单元测试（待实现）
bun run test
```

---

## 相关链接

- **全局代码索引**: /docs/00_index/CODE_INDEX.md
- **架构文档**: /docs/architecture.md
- **开发进展**: /PROGRESS.md
- **任务清单**: /BACKLOG.md
- **协作规范**: /AGENTS.md

---

**最后更新**: 2026-02-04
**维护者**: All AI Agents
