# 车险业绩分析系统 - 后端服务

**架构**: 前后端分离架构（Node.js + Express + DuckDB）
**版本**: Phase 1 MVP
**状态**: 🚧 开发中

---

## 📋 项目概述

将原纯前端架构（DuckDB-WASM）改造为前后端分离架构，实现真正的数据权限隔离：
- ✅ 后端控制数据访问，按用户权限返回数据（行级安全）
- ✅ 部署到云服务器，同事随时可用
- ✅ 保持现有 UI 和功能不变

---

## 🛠️ 技术栈

| 组件 | 技术选型 | 版本 |
|------|----------|------|
| 运行时 | Node.js | 20+ |
| Web框架 | Express | ^4.18 |
| 类型系统 | TypeScript | ^5.9 |
| 数据库 | DuckDB (Node版) | ^1.1 |
| 数据传输 | Apache Arrow | ^17.0 |
| 认证 | JWT (jsonwebtoken) | ^9.0 |
| 密码哈希 | bcrypt | ^5.1 |
| 跨域 | CORS | ^2.8 |
| 安全 | Helmet | ^7.1 |

---

## 📁 项目结构

```
server/
├── src/
│   ├── app.ts                 # Express 入口
│   ├── config/                # 配置文件
│   │   ├── database.ts        # DuckDB 配置
│   │   ├── auth.ts            # JWT 配置
│   │   └── cors.ts            # CORS 配置
│   ├── middleware/            # 中间件
│   │   ├── auth.ts            # JWT 验证
│   │   ├── permission.ts      # 权限检查 + 行级过滤
│   │   └── error.ts           # 错误处理
│   ├── routes/                # 路由（待实现）
│   │   ├── auth.ts            # POST /api/auth/login
│   │   ├── query.ts           # GET /api/query/*
│   │   └── filters.ts         # GET /api/filters/options
│   ├── services/              # 服务层
│   │   ├── duckdb.ts          # DuckDB 连接池
│   │   ├── auth.ts            # 认证逻辑
│   │   └── permission.ts      # 权限过滤
│   ├── sql/                   # SQL生成器（待复制）
│   ├── types/                 # 类型定义（待复制）
│   ├── normalize/             # 列名映射（待复制）
│   └── utils/                 # 工具函数（待复制）
├── data/                      # Parquet 数据目录
├── dist/                      # 编译输出
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🚀 快速开始

### 1. 安装依赖

```bash
cd server
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env

# 编辑 .env，设置必要的配置项
vim .env
```

**关键配置**:
```env
PORT=3000
JWT_SECRET=your-secret-key-change-in-production
CORS_ORIGIN=http://localhost:5173
DUCKDB_PATH=:memory:
DATA_PATH=./data
```

### 3. 启动开发服务器

```bash
npm run dev
```

服务器将在 `http://localhost:3000` 启动。

### 4. 验证健康检查

```bash
curl http://localhost:3000/health
```

预期响应:
```json
{
  "success": true,
  "message": "Server is running",
  "timestamp": "2026-02-02T12:00:00.000Z"
}
```

---

## 📝 开发进度

### Phase 1: MVP验证（2周）

| 任务 | 状态 | 说明 |
|------|------|------|
| ✅ 搭建Express + TypeScript项目 | DONE | 基础架构已完成 |
| ✅ 配置DuckDB连接池 | DONE | `services/duckdb.ts` |
| ✅ 实现JWT认证中间件 | DONE | `middleware/auth.ts` |
| ✅ 实现权限服务（行级安全） | DONE | `middleware/permission.ts` |
| 🔨 实现登录API | TODO | `routes/auth.ts` |
| 🔨 实现KPI查询API | TODO | `routes/query.ts` |
| 🔨 复制SQL生成器 | TODO | 从 `../src/shared/sql/` |
| 🔨 前端HTTP客户端 | TODO | `../src/api/client.ts` |
| 🔨 集成测试 | TODO | 验证权限过滤 |

---

## 🔐 安全机制

### 1. JWT认证
- 所有API请求需携带 `Authorization: Bearer <token>`
- Token有效期：24小时（可配置）
- 使用HS256算法签名

### 2. 行级安全（Row-Level Security）
```typescript
// 分公司管理员
WHERE 1=1  // 无限制，可查看所有数据

// 三级机构用户（如乐山）
WHERE org_level_3 LIKE '%乐山%'  // 只能查看本机构数据
```

### 3. SQL注入防护
- 使用参数化查询（计划中）
- SQL字符串转义（当前实现）
- 只读查询校验（复用前端 `sql-validator.ts`）

---

## 🧪 测试

```bash
# 运行单元测试
npm test

# 运行测试覆盖率
npm run test:coverage
```

---

## 📦 构建

```bash
# TypeScript编译
npm run build

# 启动生产服务器
npm start
```

---

## 🐛 故障排除

### 问题1: DuckDB初始化失败
```
Error: Failed to initialize DuckDB
```

**解决方案**:
- 检查 `DUCKDB_PATH` 配置
- 确保有文件写入权限（如使用文件数据库）
- 查看DuckDB版本兼容性

### 问题2: JWT验证失败
```
Error: Invalid token
```

**解决方案**:
- 检查 `JWT_SECRET` 是否一致
- 检查Token是否过期
- 确认Authorization头格式：`Bearer <token>`

### 问题3: CORS错误
```
Access-Control-Allow-Origin blocked
```

**解决方案**:
- 检查 `CORS_ORIGIN` 配置
- 确认前端URL匹配
- 生产环境设置正确的域名

---

## 📚 相关文档

- [前后端分离改造计划](../.claude/plans/前后端分离改造计划.md)
- [风险评估报告](../.claude/plans/前后端分离改造_风险评估报告.md)
- [DuckDB官方文档](https://duckdb.org/docs/)
- [Express官方文档](https://expressjs.com/)

---

## 📮 联系方式

如有问题，请查看 [BACKLOG.md](../BACKLOG.md) 中的任务进度。
