# AI Agents 协作指南 (AGENTS.md)

本文件是仓库级 AI Agent 协作操作系统，用于统一角色边界、流程与交付约束。执行任务时请同时遵守顶层 System/Developer/User 指令。

---


## 0.1 指挥者-执行者极简准则（新增，保留原架构）

> 用于快速执行；如与下文细则冲突，以更严格条款为准。

- **指挥者职责**：定义目标、优先级、验收标准。
- **执行者职责**：实现、验证、提交证据。
- **固定 5 步**：目标一句话 → 全库检索 → 最小改动 → 三层验证 → 证据回写。
- **完成判定**：有改动、有验证结果、有风险边界说明。
- **零容忍**：未检索即开发、未验证即宣称可用、删除模块替代修补。

## 0. AI 行为红线（ZERO TOLERANCE）

> 来源：Claude Code 使用洞察报告（36 会话 / 319 消息）

- **执行不规划**：涉及 Git 操作（commit/push/PR）直接执行命令，禁止用规划或摘要替代执行
- **先搜再写**：写代码前必须全库搜索，禁止假设“模块不存在”
- **验证不声称**：禁止声称“已可用”，必须通过真实 API 请求或浏览器验证
- **修补不拆除**：安全加固/重构时禁止删除整块插件或集成，只能修补
- **排版合规要求 (DC-003)**：严禁在 UI 层面硬编码 Tailwind 色值或虚构 CSS 类，必须通过 `import { colorClasses, fontStyles, cardStyles } from '@/shared/styles'` 获取样式。
- **并行不串行**：3+ 独立模块任务必须并行执行 subagents
- **聚焦不发散**：单次会话只完成一个明确目标，完成并验证后再继续

### Git 安全检查（推送前必做）

```bash
git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | awk '$1 == "blob" && $3 > 104857600 {print $3, $4}'
git merge-base main HEAD || echo "WARNING: no common ancestor"
```

## 0. 适用范围与优先级
- **适用范围**：仓库根目录及其所有子目录（除非存在更深层 `AGENTS.md`）。
- **优先级**：System/Developer/User 指令 > 更深层 `AGENTS.md` > 本文件。

---

## 1. 启动前必读（3分钟）

### 必经入口（强制）
- 项目架构规范（嵌套项目/子模块必读）：[ARCHITECTURE.md](./ARCHITECTURE.md)
- 技术栈声明：[开发文档/TECH_STACK.md](./开发文档/TECH_STACK.md)
- 开发者全局约定（DC-001/日期口径等）：[开发文档/DEVELOPER_CONVENTIONS.md](./开发文档/DEVELOPER_CONVENTIONS.md)

### 核心索引
- [DOC_INDEX](./开发文档/00_index/DOC_INDEX.md) - 业务规则、架构文档
- [CODE_INDEX](./开发文档/00_index/CODE_INDEX.md) - 核心模块、关键文件、禁止修改区域
- [DATA_INDEX](./开发文档/00_index/DATA_INDEX.md) - 字段定义、业务规则、分析场景
- [PROGRESS_INDEX](./开发文档/00_index/PROGRESS_INDEX.md) - 任务状态、证据链规则
- [Plans 状态快照](./.claude/plans/STATUS_SNAPSHOT.md) - plans 目录完成度快照

### 两本账（唯一真理来源）
- [BACKLOG.md](./BACKLOG.md) - 需求账本（任务状态）
- [PROGRESS.md](./PROGRESS.md) - 进展账本（里程碑、阻塞、接力信息）

### 核心工作记录
- [缺口清单.md](./开发文档/缺口清单.md) - 规划/开发前必查  
  核心原则：**没有完备信息 = 不能开始开发**
- 数据知识协议：[.claude/data-knowledge-protocol.md](./.claude/data-knowledge-protocol.md)
- 唯一事实源（业务字段/规则）：[车险数据业务规则字典.md](./数据管理/knowledge/rules/车险数据业务规则字典.md)
- 快速参考：[QUICK_REFERENCE.md](./数据管理/knowledge/QUICK_REFERENCE.md)

### Parquet Schema 知识库（AI SQL 必读）
- ⭐ [PARQUET_SCHEMA_KNOWLEDGE.md](./数据管理/knowledge/ai/PARQUET_SCHEMA_KNOWLEDGE.md)
  - 30 字段结构、类型、值域与枚举
  - NL 关键词到 SQL 字段映射
  - 常见查询模式与隐私保护规则

### 辅助指南
- [WORKFLOW.md](./WORKFLOW.md)
- [TESTING_GUIDE.md](./TESTING_GUIDE.md)
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- [GOVERNANCE_DELIVERY.md](./GOVERNANCE_DELIVERY.md)

---

## 2. 项目现状（以代码为准）

### 架构定位（CRITICAL）
本项目为**纯 API 模式**：前端通过 REST API 访问后端 DuckDB，不再使用 DuckDB-WASM / Local 模式。

- 前端状态源：`src/shared/contexts/DataContext.tsx`（`dataSource` 固定 `'api'`）
- API 客户端：`src/shared/api/client.ts`
- 后端入口：`server/src/app.ts`
- 后端查询核心：`server/src/routes/query.ts` + `server/src/services/duckdb.ts` + `server/src/sql/*.ts`

### 目录速览
- `src/`：前端应用
  - `src/app/`：应用入口（`main.tsx`, `App.tsx`）
  - `src/features/`：业务模块
  - `src/widgets/` / `src/components/`：复用组件
  - `src/shared/`：API、上下文、样式、工具、类型
  - `src/services/`：前端服务封装
- `server/`：后端 API 与 DuckDB 查询层
  - `server/src/routes/`：路由层（`query.ts`, `data.ts`, `auth.ts`, `ai.ts`, `filters.ts`）
  - `server/src/services/`：服务层（`duckdb.ts`, `auth.ts`, `permission.ts`）
  - `server/src/sql/`：SQL 生成器
  - `server/src/normalize/`：字段映射与校验
  - `server/src/middleware/`：认证/权限/审计/错误处理
- `tests/`：Vitest 测试
- `scripts/`：治理与自动化脚本
- `开发文档/`、`docs/`、`数据管理/`、`reference/`

### 常用入口定位
- 前端入口：`src/app/main.tsx`
- 根组件：`src/app/App.tsx`
- 后端入口：`server/src/app.ts`
- Vite 配置：`vite.config.ts`
- 测试入口：`tests/*.test.ts`
- 治理脚本：`scripts/check-governance.mjs`

---

## 3. 工作流程（状态机 + 交付约束）

### 状态机
```
PROPOSED → TRIAGED → IN_PROGRESS → DONE
                         ↓
                      BLOCKED → (解决后回到 IN_PROGRESS)
                         ↓
                    DEPRECATED
```

### 任务开始
1. 阅读 §1 必经入口与索引。
2. 在 `BACKLOG.md` 领取任务并标记 `IN_PROGRESS`。
3. 填写关联文档与关联代码路径。
4. 若发现信息缺口，立即登记到 `开发文档/缺口清单.md` 并按需将任务标记 `BLOCKED`。

### 开发中
- 默认使用 **Bun**（禁止 npm/yarn/pnpm 作为日常执行器）。
- 写代码前执行 §4.2 实现前检查协议，禁止重复造轮子。
- 修改核心目录后，同步更新对应 `INDEX.md`（只允许追加，不允许删除历史条目）。
- 严格遵守 §4 红线文件与架构护栏。

### 完成与交付
1. `BACKLOG.md` 任务状态改为 `DONE`，补全证据链。
2. 运行治理校验：`bun run governance`。
3. 执行测试（至少 `bun run test`；按改动补充专项验证）。
4. 建议执行冲突检查：`bun run scripts/check-write-conflict.mjs`。

### 常用命令
- 安装依赖：`bun install`
- 一键启动前后端（推荐）：`bun run dev:full`
- 仅前端：`bun run dev`
- 构建：`bun run build`
- 预览：`bun run preview`
- 单测：`bun run test`
- 覆盖率：`bun run test:coverage`
- 治理校验：`bun run governance`
- 计划管理：`bun run plans:manage`

**测试命令说明**：
- 优先使用 `bun run test`（调用项目 Vitest 配置）。
- `bun test` 使用 Bun 内置 runner，DOM/RTL 测试可能不兼容。

---

## 4. 关键护栏（必须遵守）

### 4.1 API 模式启动与验证协议（MUST）

**核心要求**：开发环境必须同时具备前后端，禁止仅以前端页面状态判断数据可用性。

**推荐启动方式**：
```bash
bun run dev:full
```

**启动脚本联动（强制）**：
- `bun run dev:full` → `node scripts/start.mjs --all`
- 启动前自动清理旧端口占用（`3000`, `5173-5176`），然后再启动后端+前端
- 若端口无法释放，脚本会终止启动并输出 PID；必须处理后重试

**禁止行为**：
- 只运行 `bun run dev` 后直接排查“暂无数据”问题
- 未确认后端路由存在就新增前端 API 调用
- 只做自检结论、不落地修复（例如已发现端口冲突但不处理）

**数据启用判断（前端）**：
```typescript
const { isDataLoaded } = useDataStatus();
const isDataEnabled = isDataLoaded;
```

**排查顺序**：
1. 用户是否登录（Token 是否存在）
2. 后端是否启动（3000 端口）
3. 后端是否有当前加载文件
4. 浏览器网络面板中 `/api/*` 是否 200
5. `isDataLoaded` 是否为 `true`

**闭环要求**：
- 排查必须收敛到“问题已解决或有明确阻塞依赖”，不能停留在“已发现问题”。

### 4.2 实现前检查协议（防止重复造轮子）

**三问原则（写代码前必答）**：

| 问题 | 检查方式 |
|------|----------|
| 已有吗？ | 查 `CODE_INDEX.md` 与对应模块 `INDEX.md` |
| 能复用吗？ | 查 `src/shared/` 与 `server/src/utils/` |
| 有模式吗？ | 查同类实现（同页面/同模块/同 SQL 生成器） |

**组件/工具注册表（强制查询）**：

| 类别 | 位置 | 示例 |
|------|------|------|
| UI组件 | `src/widgets/INDEX.md` | Table、Card、Badge、Button |
| 样式系统 | `src/shared/styles/index.ts` | `tableStyles`、`textStyles`、`buttonStyles` |
| API 客户端 | `src/shared/api/client.ts` | 所有前端 API 方法 |
| SQL 生成器 | `server/src/sql/` | `kpi.ts`、`trend.ts`、`cost.ts` |
| 工具函数 | `src/shared/utils/formatters.ts` | 统一数值格式化 |

**全局样式设定（UI开发必用）**：
```typescript
// ✅ 正确
import { tableStyles, textStyles, buttonStyles, cn } from '@/shared/styles';
import { Card, Badge, Button } from '@/shared/ui';

// ❌ 错误：硬编码 Tailwind 样式
// className="bg-white rounded-lg shadow-sm p-4"
```

**格式化规范（MUST）**：
- 统一使用 `src/shared/utils/formatters.ts` 中函数（如 `formatCount`, `formatPercent`, `formatPremiumWan`）
- 数字展示统一使用 `textStyles.numeric`

**违规判定**：
- ❌ 已有能力重复实现
- ❌ 硬编码通用样式与格式化逻辑
- ❌ 新增通用组件/脚本未登记 `INDEX.md`

### 4.3 业务口径与架构红线（RED LINE）

**业务口径定义（只能追加，不得删改已有语义）**：
- `server/src/normalize/mapping.ts`
- `server/src/sql/kpi.ts`

**后端核心协议（禁止破坏）**：
- `server/src/services/duckdb.ts`：不得随意改写既有查询逻辑/视图语义
- `server/src/routes/query.ts`：不得删除既有路由，仅允许追加并保持向后兼容
- `server/src/middleware/auth.ts`：`/api/*` 路由必须经过认证中间件

**前端架构协议（禁止回退到本地模式）**：
- `src/shared/contexts/DataContext.tsx` 中 `dataSource='api'` 语义不可破坏
- 禁止新增 DuckDB-WASM / 本地 DuckDB 分支逻辑

**索引文件规则**：
- 所有 `INDEX.md`：只允许追加，禁止删除历史条目

### 4.4 DC-002 用户筛选优先规则（强制）

**核心原则**：用户筛选条件优先于系统默认值。

**规则**：
1. 禁止硬编码日期函数：`CURRENT_DATE` / `NOW()` / `CURDATE()`（除非有 `DC-002 Exception` 注释）
2. 判断筛选字段时优先使用 `??`，禁止在日期筛选判断中使用 `||`
3. SQL 生成器不得通过“可选日期参数”绕开筛选器来源

**推荐工具**：
- `src/shared/types/dc-002-guard.ts`
- `server/src/types/dc-002-guard.ts`

**检测与验证**：
- 治理检查：`bun run governance`
- 代码检索：`rg "CURRENT_DATE|NOW\\(|CURDATE\\(|\\|\\|" server/src/sql src/shared`

**例外声明写法**：
```sql
-- DC-002 Exception: YTD查询需要动态获取当前年份
WHERE year = EXTRACT(YEAR FROM CURRENT_DATE)
```

**详细文档**：[开发文档/DC-002_ROOT_CAUSE_ANALYSIS.md](./开发文档/DC-002_ROOT_CAUSE_ANALYSIS.md)

### 4.5 验证协议（禁止自我安慰式开发）

强制三层验证：
1. 单元测试：`bun run test`
2. 浏览器实测：Network/Console 验证 API 请求与数据结果
3. 用户验收：按需求场景做人工确认

高风险改动（SQL、筛选、时间维度、权限）必须记录可复现证据（日志/截图/测试输出）。

---

## 5. 角色定义与边界

### 5.1 开发 Agent (Developer Agent)
**职责**：实现功能、修复 Bug、补充测试、维护可运行性。

**可读入口**：
- `开发文档/00_index/*.md`
- `BACKLOG.md` / `PROGRESS.md`
- `src/*/README.md`, `server/README.md`

**必须回写**：
1. `BACKLOG.md` 状态与证据链
2. 关联代码/文档路径
3. 新增文件对应 `INDEX.md`
4. 信息缺口登记到 `开发文档/缺口清单.md`

**禁止触碰区域**：
- ❌ `server/src/normalize/mapping.ts`（仅追加）
- ❌ `server/src/sql/kpi.ts`（仅追加）
- ❌ 删除既有 API 路由或核心口径语义
- ❌ 删除任何 `INDEX.md` 历史条目

### 5.2 文档 Agent (Documentation Agent)
**职责**：维护文档、索引、说明与证据链可追溯性。

**可读入口**：
- `开发文档/00_index/*.md`
- `src/*/README.md`, `server/README.md`

**必须回写**：
1. 相关 README / 规范文档
2. 对应 `INDEX.md` 条目
3. `BACKLOG.md` 文档任务状态与证据
4. 缺口清单格式与状态维护

**禁止触碰区域**：
- ❌ 直接改业务口径定义（只能解释，不能改语义）
- ❌ 删除历史索引条目

### 5.3 测试 Agent (Testing Agent)
**职责**：编写/维护单元与集成测试，输出验证证据。

**可读入口**：
- `tests/*.test.ts`
- `src/shared/`, `server/src/sql/`, `server/src/normalize/`
- [TESTING_GUIDE.md](./TESTING_GUIDE.md)

**必须回写**：
1. `tests/` 测试文件
2. `BACKLOG.md` 测试任务状态与证据
3. 测试报告（文本或截图）

**禁止触碰区域**：
- ❌ 无明确授权时不改生产业务口径
- ❌ 不得跳过失败测试直接标记 DONE

### 5.4 治理 Agent (Governance Agent)
**职责**：维护治理体系、审计证据链、修复索引一致性。

**可读入口**：
- 治理与索引：`开发文档/00_index/*.md`, `src/*/INDEX.md`, `scripts/INDEX.md`
- 账本：`BACKLOG.md`, `PROGRESS.md`
- 脚本：`scripts/check-governance.mjs`

**必须回写**：
1. 缺失的 `INDEX.md` 条目
2. DONE 任务证据链完整性修正
3. `PROGRESS.md` 里程碑/阻塞更新

**允许触碰但需谨慎**：
- ✅ `CLAUDE.md`, `AGENTS.md`, `BACKLOG.md`, `PROGRESS.md`
- ✅ 治理脚本（保持向后兼容）

**禁止触碰区域**：
- ❌ 业务功能代码实现（除非用户明确授权）
- ❌ 未经确认修改业务口径定义

### 5.5 架构师 Agent (Architect Agent)
**职责**：架构设计、重构方案、技术评审与风险预案。

**可读入口**：
- `ARCHITECTURE.md`
- `开发文档/00_index/DOC_INDEX.md`
- `开发文档/00_index/CODE_INDEX.md`
- `server/README.md`

**必须回写**：
1. 架构方案文档（可放 `开发文档/`）
2. `BACKLOG.md` 重构任务（`PROPOSED`）
3. 影响模块 README 更新

**禁止触碰区域**：
- ❌ 未获授权直接改生产代码
- ❌ 未经产品确认修改业务口径

---

## 6. 并发协作与异常处理

### 并发规则
- 同一任务只允许一个 Agent 处于 `IN_PROGRESS`。
- 超过 24 小时无更新的占用任务，可在 `PROGRESS.md` 标记阻塞并申请接管。

### 多 Agent 任务 ID 范围（治理强校验）
- `@user`：B001-B099
- `@claude`：B100-B199
- `@codex`：B200-B299
- `@gemini`：B300-B399
- `@trae`：B400-B499
- `@kilo`：B500-B599
- `@codebuddy`：B600-B699

### PR 前检查（推荐）
```bash
git fetch origin main && git rebase origin/main
bun run scripts/check-write-conflict.mjs
bun run governance
```

### 异常处理
1. 发现业务口径错误：`BACKLOG.md` 新增 `BLOCKED` 任务并标注“需产品确认”
2. 发现信息缺口：登记 `开发文档/缺口清单.md`，并在 `PROGRESS.md` 标注阻塞
3. 发现索引不一致：执行 `bun run governance`，按输出补全缺失项
4. API 调用失败：先核对前端 API 方法与后端路由是否一一对应，再查权限与过滤注入逻辑

---

## 7. 异常处理矩阵

| 异常 | Developer | Documentation | Testing | Governance | Architect |
|------|-----------|---------------|---------|------------|-----------|
| 业务口径错误 | ❌ 不直接改<br>📝 标记 BLOCKED | ❌ 不直接改<br>📝 记录影响 | ❌ 不改口径<br>✅ 增补回归测试 | ✅ 审计并升级 | ✅ 提方案，待确认 |
| 架构缺陷 | 📝 提 PROPOSED | 📝 补文档说明 | 📝 补覆盖 | 📝 记录风险 | ✅ 主导方案 |
| 测试缺失 | ✅ 可补测试 | 📝 更新测试文档 | ✅ 主责 | 📝 审计覆盖率 | 📝 给策略 |
| 文档缺失 | 📝 可补最小文档 | ✅ 主责补齐 | 📝 补测试说明 | ✅ 审计完整性 | 📝 补架构文档 |
| 索引不一致 | ✅ 可修复 | ✅ 可修复 | ❌ 非主责 | ✅ 主责修复 | ✅ 可修复 |

---

## 8. 生产部署与数据同步

### VPS 信息

| 项目 | 值 |
|------|-----|
| 服务器 | 腾讯云轻量 2核4G（162.14.113.44） |
| 域名 | `https://chexian.cretvalu.com` |
| 后端进程 | PM2 → `chexian-api`（端口 3000） |
| 前端 | Nginx 静态文件（`/var/www/chexian/frontend/dist`） |

### SSH 连接前提（必须先配置）

**本地 `~/.ssh/config` 必须包含以下配置**（缺失则所有脚本无法运行）：

```
Host chexian-vps
    HostName 162.14.113.44
    User root
    IdentityFile ~/.ssh/chexian_deploy
    ServerAliveInterval 60
```

**验证连通性**：
```bash
ssh chexian-vps echo ok   # 返回 "ok" 表示配置正确
```

### 数据同步（本地 Mac → VPS）

```bash
# 完整链路：Excel → Parquet 转换 + 自动同步 VPS
./数据管理/run.sh full \
  --source 历史数据.xlsx \
  --target 最新数据.xlsx \
  --output 数据管理/warehouse/fact/policy/车险保单综合明细表MMDD.parquet

# 仅本地转换，不同步 VPS
./数据管理/run.sh full ... --no-sync

# 单独同步已有 Parquet（跳过转换步骤）
./deploy/sync-data.sh              # 自动找最新 Parquet
./deploy/sync-data.sh 文件名.parquet  # 指定文件
```

脚本自动完成：SSH 连通性检查 → 找到最新 `.parquet` → scp 上传 → chmod 600 → PM2 重启 → 健康检查。

### SSH 故障排查

| 现象 | 原因 | 修复方式 |
|------|------|----------|
| `ssh: Could not resolve hostname chexian-vps` | `~/.ssh/config` 未配置别名 | 添加上方 Host 配置 |
| `Permission denied (publickey)` | 密钥不匹配或未在 VPS 授权 | 检查 `~/.ssh/chexian_deploy` 存在；确认公钥在 VPS `~/.ssh/authorized_keys` |
| 连接超时 | 网络/防火墙问题 | 检查腾讯云安全组是否开放 22 端口 |
| 健康检查失败（上传后） | PM2 重启期间竞争 | 手动 `ssh chexian-vps "pm2 logs chexian-api --lines 20"` 查看错误 |

### 相关文件

| 文件 | 说明 |
|------|------|
| [deploy/sync-data.sh](deploy/sync-data.sh) | 数据同步脚本（使用 `chexian-vps` 别名） |
| [数据管理/run.sh](数据管理/run.sh) | 完整数据处理链路（enrich + transform + sync） |
| [deploy/vps-deploy.sh](deploy/vps-deploy.sh) | VPS 全量部署脚本 |
| [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) | 完整部署步骤文档 |
| [vps.md](vps.md) | VPS 运维手册（SSH/PM2/Nginx/备份） |

---

**变更历史**：
- 2026-02-23：§8 新增 SSH 连接前提（`~/.ssh/config` 别名），补充一键链路与故障排查表
- 2026-02-15：新增§8生产部署与数据同步章节，添加一键 `sync-data.sh` 脚本引用
- 2026-02-15：基于 `CLAUDE.md` 与当前代码现状重构，统一为纯 API 架构、更新红线文件与启动验证协议
- 2026-01-19：新增实现前检查协议（防止重复造轮子）
- 2026-01-08：重构流程描述并对齐最佳实践
- 2026-01-07：建立多 Agent 协作操作系统
