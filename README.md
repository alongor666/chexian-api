# 车险经营管理系统 (Insurance Sales Dashboard)

**版本**: v2.2
**最后更新**: 2026-02-04

一个基于 **React + TypeScript + DuckDB** 的高性能车险销售数据分析看板，采用前后端分离架构，专为保险公司业绩管理设计。

## 🚀 核心特性

### 技术架构
- **前后端分离**: Node.js 后端 + React 前端，支持多用户并发访问
- **双 DuckDB 架构**: 后端 DuckDB (Node.js) + 前端 DuckDB-WASM，数据自动同步
- **JWT 认证**: 安全的用户认证和权限管理
- **Arrow IPC**: Worker 返回二进制 Arrow 格式，避免 JSON 序列化开销
- **COOP/COEP 安全头**: 支持跨域隔离的 DuckDB-WASM 运行环境
- **TypeScript 严格模式**: 全面的类型安全保障

### 业务功能
- **PolicyFact 视图**: 强制实现"保单去重"业务逻辑 (MAX Premium)
- **渐进式加载**: KPI 优先显示，图表和明细数据异步加载
- **RequestId 机制**: 自动取消过期请求，避免数据混乱
- **多维度分析**: 支持按机构、业务员、时间等多维度下钻分析

### 数据处理
- **Excel 转换**: 内置 Excel 到 Parquet 的转换脚本
- **数据质量检测**: 自动验证数据完整性和业务规则
- **字段映射**: 灵活的字段名映射配置系统

## 📁 项目结构

```
├── src/                      # 前端源码
│   ├── app/                  # 应用入口和全局配置
│   │   ├── App.tsx          # 根组件
│   │   ├── main.tsx         # 应用启动点
│   │   └── index.css        # 全局样式
│   ├── shared/              # 共享业务逻辑
│   │   ├── api/             # API 客户端
│   │   │   └── client.ts    # 后端 API 调用封装
│   │   ├── contexts/        # React Context
│   │   │   ├── DataContext.tsx      # 数据状态管理
│   │   │   └── PermissionContext.tsx # 权限状态管理
│   │   ├── duckdb/          # DuckDB-WASM 客户端
│   │   │   ├── client.ts    # 前端数据库客户端
│   │   │   └── worker.ts    # Web Worker 实现
│   │   ├── sql/             # SQL 模板集中管理
│   │   ├── normalize/       # 数据标准化
│   │   └── utils/           # 通用工具函数
│   ├── features/            # 业务功能模块
│   │   ├── home/            # 首页数据导入
│   │   ├── dashboard/       # 仪表盘
│   │   ├── filters/         # 筛选功能
│   │   ├── auth/            # 用户认证
│   │   └── ...              # 其他功能模块
│   └── widgets/             # 通用UI组件
│
├── server/                   # 后端服务
│   ├── src/
│   │   ├── app.ts           # Express 应用入口
│   │   ├── routes/          # API 路由
│   │   │   ├── auth.ts      # 认证路由
│   │   │   ├── data.ts      # 数据管理路由
│   │   │   └── query.ts     # 查询路由
│   │   ├── services/        # 业务服务
│   │   │   └── duckdb.ts    # 后端 DuckDB 服务
│   │   ├── middleware/      # 中间件
│   │   │   ├── auth.ts      # JWT 认证中间件
│   │   │   └── error.ts     # 错误处理中间件
│   │   └── utils/           # 工具函数
│   │       └── security.ts  # 安全工具（路径验证等）
│   └── data/                # 数据文件目录
│       └── *.parquet        # Parquet 数据文件
│
├── tests/                    # Vitest 单元测试
├── scripts/                  # 构建和治理脚本
├── 签单清洗/                 # 数据处理脚本
├── 数据管理/                 # 数据仓库目录
└── 开发文档/                 # 项目文档
```

## 🛠️ 技术栈

### 前端
- **React 18.3.1** - 用户界面框架
- **TypeScript 5.5.3** - 类型安全的 JavaScript
- **Vite 5.4.1** - 现代化构建工具
- **DuckDB-WASM 1.28.0** - 浏览器端数据分析引擎
- **Apache Arrow 17.0.0** - 高性能列式内存格式
- **ECharts 5.5.0** - 数据可视化图表库
- **Tailwind CSS 3.4.4** - 实用优先的 CSS 框架

### 后端
- **Node.js 18+** - 服务端运行时
- **Express 4.x** - Web 框架
- **DuckDB (Node.js)** - 服务端数据分析引擎
- **JWT** - 用户认证
- **Multer** - 文件上传处理
- **Zod** - 数据验证

### 开发工具
- **Bun** - 高性能包管理器
- **Vitest 2.0.5** - 单元测试框架
- **ESLint + Prettier** - 代码质量和格式化
- **tsx** - TypeScript 执行器

## 🚀 快速开始

### 环境要求
- **Node.js** 18+
- **Bun** 最新版本（推荐）
- **Python** 3.8+（数据转换脚本需要）

### 1. 克隆项目
```bash
git clone <repository-url>
cd chexianYJFX
```

### 2. 安装依赖
```bash
# 安装前端依赖
bun install

# 安装后端依赖
cd server && bun install && cd ..
```

### 3. 数据准备

将 Parquet 数据文件放置在 `server/data/` 目录下：
```bash
cp your-data.parquet server/data/
```

或从 Excel 转换：
```bash
cd 签单清洗
python Excel转Parquet优化处理脚本.py
# 转换后的文件会自动放入 数据管理/warehouse/fact/policy/ 目录
# 需手动复制到 server/data/ 目录
```

### 4. 启动服务

#### 方式一：同时启动前后端（推荐）
```bash
# 终端 1：启动后端服务（端口 3000）
cd server && bun run dev

# 终端 2：启动前端服务（端口 5173）
bun run dev
```

#### 方式二：仅启动前端（开发模式）
```bash
bun run dev
```

### 5. 访问应用

1. 打开浏览器访问 `http://localhost:5173`
2. 使用以下账号登录：
   - **管理员**: `admin` / `admin123`（可查看所有机构数据）
   - **机构用户**: 快速切换面板选择（仅可查看本机构数据）
3. 在首页选择数据文件并点击"加载"
4. 数据加载完成后自动跳转到仪表盘

### 6. 运行测试
```bash
bun test          # 运行所有测试
bun test --watch  # 监听模式
```

### 7. 构建生产版本
```bash
bun run build     # 构建生产版本
bun run preview   # 预览生产版本
```

## 🏗️ 系统架构

### 数据流程
```
┌─────────────────────────────────────────────────────────────────┐
│                        用户浏览器                                │
├─────────────────────────────────────────────────────────────────┤
│  React 前端 (localhost:5173)                                    │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ 用户登录     │───>│ JWT Token    │───>│ API 请求     │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                                       │               │
│         v                                       v               │
│  ┌──────────────┐                      ┌──────────────┐        │
│  │ 权限管理     │                      │ 数据管理     │        │
│  │ Permission   │                      │ DataContext  │        │
│  │ Context      │                      └──────────────┘        │
│  └──────────────┘                              │               │
│                                                v               │
│                                       ┌──────────────┐        │
│                                       │ DuckDB-WASM  │        │
│                                       │ (前端查询)   │        │
│                                       └──────────────┘        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              v
┌─────────────────────────────────────────────────────────────────┐
│  Node.js 后端 (localhost:3000)                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ /api/auth    │    │ /api/data    │    │ /api/query   │      │
│  │ 用户认证     │    │ 文件管理     │    │ 数据查询     │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                   │                   │               │
│         v                   v                   v               │
│  ┌──────────────────────────────────────────────────────┐      │
│  │                    DuckDB (Node.js)                   │      │
│  │              server/data/*.parquet                    │      │
│  └──────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

### 数据加载流程
1. 用户登录获取 JWT Token
2. 前端调用 `/api/data/files` 获取可用数据文件列表
3. 用户选择文件，前端调用 `/api/data/load/:filename` 通知后端加载
4. 前端调用 `/api/data/download/:filename` 下载 Parquet 文件
5. 前端 DuckDB-WASM 加载 Parquet 文件，创建 PolicyFact 视图
6. 前端图表直接查询 DuckDB-WASM（高性能、零网络延迟）

### API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/auth/login` | POST | 用户登录，返回 JWT |
| `/api/data/files` | GET | 获取数据文件列表 |
| `/api/data/load/:filename` | POST | 加载指定数据文件 |
| `/api/data/download/:filename` | GET | 下载 Parquet 文件 |
| `/api/data/upload` | POST | 上传新数据文件 |
| `/api/query/kpi` | GET | 获取 KPI 数据 |
| `/api/query/trend` | GET | 获取趋势数据 |
| `/api/filters/options` | GET | 获取筛选器选项 |

## 📊 业务规则

### 数据口径
- **数据粒度**: 保单级别
- **去重规则**: 同一 `policy_no` 取 `MAX(premium)`
- **时间维度**: 支持自然日、自然周、自然月、季度、年度

### 核心 KPI
- **总保费**: 所有保单保费总和（去重后）
- **机构数**: 有业务发生的机构数量
- **业务员数**: 有业绩记录的业务员数量
- **人均保费**: 总保费 ÷ 业务员数
- **续保占比**: 续保保单 ÷ 总保单数
- **新能源占比**: 新能源车险保费 ÷ 总保费

### 数据质量规则
- 必填字段：`policy_no`、`premium`、`org_code`、`agent_code`
- 数值范围：`premium > 0`
- 日期格式：统一为 YYYY-MM-DD
- 编码规范：机构和业务员编码符合公司标准

## 🔧 配置说明

### 环境变量

#### 前端配置 (`.env.local`)
```env
# API 后端地址
VITE_API_BASE=http://localhost:3000/api
```

#### 后端配置 (`server/.env`)
```env
# 服务端口
PORT=3000

# JWT 密钥（生产环境请使用强密钥）
JWT_SECRET=your-secret-key

# 数据目录
DATA_DIR=./data

# CORS 允许的前端地址
CORS_ORIGIN=http://localhost:5173
```

### 字段映射配置
编辑 `src/shared/normalize/mapping.ts`：
```typescript
export const fieldMapping = {
  // Excel 字段名 -> 标准字段名
  '保单号': 'policy_no',
  '保费': 'premium',
  '机构代码': 'org_code',
  // ... 更多映射
}
```

### DuckDB 配置
在 `src/shared/duckdb/client.ts` 中：
```typescript
export const duckDBConfig = {
  queryTimeout: 30000,
  memoryLimit: '1GB',
  threads: navigator.hardwareConcurrency || 4
}
```

## 🧪 测试策略

### 单元测试
- KPI 计算逻辑测试
- 数据映射和验证测试
- SQL 查询模板测试
- 安全功能测试

### 集成测试
- DuckDB 连接和查询测试
- 数据导入流程测试
- UI 组件渲染测试

### 性能测试
- 大数据集查询性能
- 内存使用监控
- 组件渲染性能

## 📋 治理和规范

### 代码规范
- 遵循 ESLint 和 Prettier 配置
- 使用 TypeScript 严格模式
- 函数必须包含中文注释
- 遵循 React Hooks 最佳实践

### 治理检查
```bash
bun run governance  # 运行治理规则检查
```

### 文档要求
- 所有新功能必须更新相应文档
- 重大变更需要更新 CHANGELOG
- API 变更需要更新接口文档

## 🤖 AI 协作功能

### Claude Code 工作流
本项目集成了完整的 Claude Code 工作流：

#### 可用命令
- `/commit-push-pr` - Git 工作流自动化
- `/data-analysis` - 车险数据分析报告
- `/weekly-report` - 业务周报生成
- `/security-review` - 代码安全审查

#### MCP 服务器
- **GitHub MCP**: Issue/PR 管理
- **Puppeteer MCP**: 浏览器自动化测试
- **Filesystem MCP**: 文件操作

详细说明请查看：
- [WORKFLOW.md](./WORKFLOW.md) - 工作流使用指南
- [CLAUDE.md](./CLAUDE.md) - 项目上下文和开发规范
- [AGENTS.md](./AGENTS.md) - AI代理配置说明

## 📚 相关文档

### 开发文档
- **[开发文档/00_index/CODE_INDEX.md](./开发文档/00_index/CODE_INDEX.md)** - 代码索引
- **[开发文档/00_index/DOC_INDEX.md](./开发文档/00_index/DOC_INDEX.md)** - 文档索引
- **[开发文档/TECH_STACK.md](./开发文档/TECH_STACK.md)** - 技术栈详细说明
- **[开发文档/AI_COLLABORATION.md](./开发文档/AI_COLLABORATION.md)** - AI 协作指南

### 项目治理
- **[BACKLOG.md](./BACKLOG.md)** - 任务待办列表
- **[PROGRESS.md](./PROGRESS.md)** - 项目进度记录
- **[TESTING_GUIDE.md](./TESTING_GUIDE.md)** - 测试指南和预期结果

### 规则文档
- **[.trae/rules/](./.trae/rules/)** - 项目治理规则
  - [治理框架](./.trae/rules/01-governance-framework.md)
  - [协作协议](./.trae/rules/02-collaboration-protocol.md)
  - [护栏机制](./.trae/rules/03-guardrails.md)
  - [交付标准](./.trae/rules/04-delivery-standards.md)

## 🚨 故障排除

### 常见问题

#### 后端连接失败
```bash
# 检查后端是否运行
curl http://localhost:3000/api/data/files

# 如果返回 401，说明需要认证
# 先登录获取 token
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

#### 文件列表不显示
1. 确认后端服务已启动 (`cd server && bun run dev`)
2. 确认已登录（检查 localStorage 中的 `auth_token`）
3. 检查 `server/data/` 目录下是否有 `.parquet` 文件
4. 刷新页面重新加载

#### 数据加载失败 "Cannot read properties of undefined"
- 刷新页面后重试
- 检查后端日志是否有错误
- 确认 Parquet 文件格式正确

#### DuckDB 初始化失败
```bash
# 检查 COOP/COEP 头设置
curl -I http://localhost:5173
```

#### 性能问题
- 检查数据集大小（建议 < 500MB）
- 调整 DuckDB 内存限制
- 使用查询缓存机制

### 调试工具
- 浏览器开发者工具 (F12)
- 后端日志 (`server/` 终端输出)
- React DevTools
- Vitest 调试模式

### 端口占用
```bash
# 查看端口占用
lsof -i :3000  # 后端
lsof -i :5173  # 前端

# 杀死占用进程
kill -9 <PID>
```

## 📄 许可证

本项目采用 [MIT 许可证](./LICENSE)。

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

请确保：
- 通过所有测试
- 遵循代码规范
- 更新相关文档
- 通过治理检查

---

## 📞 联系方式

如有问题或建议，请通过以下方式联系：

- 创建 [GitHub Issue](https://github.com/your-repo/issues)
- 发送邮件至项目维护者
- 在项目讨论区留言

---

**⚡ 提示**: 建议使用 Bun 作为包管理器以获得最佳性能体验。如果遇到问题，请先查看 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) 文档。