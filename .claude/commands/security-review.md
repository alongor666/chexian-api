---
name: security-review
description: 车险业绩看板全面安全审查（SQL注入、XSS、CORS等8项检查）
category: security
version: 2.0.0
author: "@claude"
tags: [security, audit, sql-injection, xss, cors, validation]
scope: project
requires:
  - grep
  - bun
dependencies:
  - tests/security.test.ts
  - tests/sql-validator.test.ts
  - src/shared/utils/security.ts
last_updated: "2026-01-11"
---

# 车险业绩看板安全审查

对车险业绩看板进行全面的安全审查，识别潜在的安全漏洞和最佳实践违规。

---

## 项目安全概况

**技术栈安全特征**：
- **前端**: React 18.3.1 + TypeScript 5.6.3（类型安全）
- **数据引擎**: DuckDB-WASM 1.29.0（浏览器内分析）
- **构建工具**: Vite 5.4.1 + Bun（现代工具链）
- **安全机制**: SQL 验证器、输入清理、文件上传防护

**已实现的安全措施**：
- ✅ SQL 注入防护（`src/shared/utils/security.ts`）
- ✅ SQL 验证器（`src/shared/utils/sql-validator.ts`）
- ✅ 文件上传安全（路径遍历防护、大小限制）
- ✅ CORS 配置（COOP/COEP 头部）
- ✅ 隐私保护（policy_no 明细查询禁止）
- ✅ 单元测试覆盖（89+ 测试用例）

---

## 🚀 快速使用子命令

**推荐**: 使用专项子命令进行针对性审查。

| 子命令 | 功能 | 检查项数 |
|--------|------|---------|
| `/security-sql` | SQL注入防护 | 2项 |
| `/security-xss` | XSS防护 | 1项 |
| `/security-cors` | CORS与文件上传 | 2项 |
| `/security-all` | 全量审查 | 8项 |

**完整审查**: 使用本命令执行所有8项安全检查。

---

## 审查范围

**默认**: 审查所有已修改的文件

**自定义**: 使用 `--target` 指定文件或目录
```bash
/security-review --target src/shared/utils
/security-review --target src/features/dashboard
/security-review --target all  # 全量审查
```

**当前变更**：
```bash
$(git diff --name-only main)
```

---

## 审查清单（按优先级）

### 1. SQL 注入防护（🔴 Critical）

**项目特定风险**: DuckDB-WASM 在浏览器中运行，SQL 注入可导致数据泄露或 DoS

**检查项**：
- [ ] 所有用户输入使用 `sanitizeInput()` 清理
- [ ] 所有 SQL 查询通过 `validateSQL()` 验证
- [ ] LIKE 子句使用 `buildSafeLikeClause()` 构建
- [ ] 禁止字符串拼接构建 SQL
- [ ] SQL 查询长度限制（<= 1000 字符）

**审查位置**：
```bash
# 搜索潜在的 SQL 拼接
grep -r "WHERE.*\${" src/ --include="*.ts" --include="*.tsx"
grep -r "SELECT.*\${" src/ --include="*.ts" --include="*.tsx"

# 检查是否使用安全函数
grep -r "sanitizeInput" src/
grep -r "validateSQL" src/
grep -r "buildSafeLikeClause" src/
```

**示例问题**：
```typescript
// ❌ 危险：直接拼接 SQL
const sql = `SELECT * FROM PolicyFact WHERE salesman_name = '${userInput}'`;

// ✅ 安全：使用 buildSafeLikeClause
const whereClause = buildSafeLikeClause('salesman_name', userInput);
const sql = `SELECT COUNT(*) FROM PolicyFact WHERE ${whereClause}`;

// ✅ 更安全：先验证后使用
const validatedInput = sanitizeInput(userInput);
validateFilterInput(validatedInput); // throws on invalid input
const sql = `SELECT COUNT(*) FROM PolicyFact WHERE salesman_name LIKE '%${validatedInput}%'`;
```

**单元测试覆盖**：
- `tests/security.test.ts`：输入清理和验证（74 测试用例）
- `tests/sql-validator.test.ts`：SQL 验证器（62 测试用例）

---

### 2. SQL 验证器合规性（🔴 Critical）

**项目特定要求**: 所有自定义 SQL 必须满足 5 项约束

**检查项**：
- [ ] **只读限制**: 仅允许 SELECT 和 WITH 语句
- [ ] **单语句限制**: 禁止多语句（`;` 分隔）
- [ ] **PolicyFact 边界**: 必须引用 PolicyFact 视图
- [ ] **隐私保护**: 禁止 SELECT policy_no（WHERE 可用）
- [ ] **聚合要求**: 必须包含聚合函数或 GROUP BY

**审查位置**：
```bash
# 检查自定义 SQL 构建
grep -r "query(" src/ --include="*.ts" --include="*.tsx"
grep -r "SELECT" src/ --include="*.ts" --include="*.tsx"

# 检查是否绕过验证器
grep -r "executeQuery" src/
grep -r "rawQuery" src/
```

**示例问题**：
```typescript
// ❌ 违反隐私保护：SELECT policy_no 明细
const sql = `
  SELECT policy_no, salesman_name, premium
  FROM PolicyFact
  GROUP BY policy_no, salesman_name, premium
`;
// 错误：policy_no 不能出现在 SELECT 列表

// ✅ 正确：policy_no 仅在 WHERE 使用
const sql = `
  SELECT salesman_name, SUM(premium) as total_premium
  FROM PolicyFact
  WHERE policy_no IS NOT NULL
  GROUP BY salesman_name
`;

// ❌ 违反只读限制
const sql = `
  SELECT * FROM PolicyFact;
  DROP TABLE PolicyFact;
`;

// ❌ 违反聚合要求
const sql = `SELECT salesman_name FROM PolicyFact`;

// ✅ 正确：包含聚合
const sql = `SELECT salesman_name, COUNT(*) FROM PolicyFact GROUP BY salesman_name`;
```

**验证规则详情**（`src/shared/utils/sql-validator.ts`）：
1. 长度限制: <= 1000 字符
2. 只读: 禁止 INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, TRUNCATE
3. 文件操作: 禁止 read_parquet, read_csv, write_parquet, copy_to
4. 系统操作: 禁止 PRAGMA, SET, CALL
5. 表边界: 必须引用 PolicyFact，禁止 raw_parquet
6. 隐私保护: policy_no 不能在 SELECT 列表
7. 聚合要求: 必须包含 COUNT/SUM/AVG/MIN/MAX 或 GROUP BY

---

### 3. 文件上传安全（🔴 Critical）

**项目特定风险**: 用户上传 Parquet 文件，需防止路径遍历和恶意文件

**检查项**：
- [ ] 文件类型验证（仅允许 `.parquet` 和 `.pq`）
- [ ] 文件大小限制（<= 50MB）
- [ ] 文件名路径遍历防护（`../`, `..\\`）
- [ ] 文件名非法字符过滤
- [ ] 文件内容验证（Parquet 格式）

**审查位置**：
```bash
# 检查文件上传处理
grep -r "FileReader" src/
grep -r "readAsArrayBuffer" src/
grep -r "validateUploadedFile" src/
```

**示例问题**：
```typescript
// ❌ 危险：未验证文件
const file = event.target.files[0];
const buffer = await file.arrayBuffer();
await duckdb.loadParquet(buffer); // 直接加载

// ✅ 安全：先验证后加载
const file = event.target.files[0];
const validation = validateUploadedFile(file);

if (!validation.valid) {
  throw new Error(validation.error);
}

const buffer = await file.arrayBuffer();
await duckdb.loadParquet(buffer);
```

**验证规则详情**（`src/shared/utils/security.ts`）：
```typescript
export const SECURITY_LIMITS = {
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
  MAX_FILTER_LENGTH: 100,
  MAX_QUERY_LENGTH: 1000,
} as const;

export function validateUploadedFile(file: File): ValidationResult {
  // 1. 文件大小检查
  if (file.size > SECURITY_LIMITS.MAX_FILE_SIZE) {
    return { valid: false, error: '文件过大，最大支持 50MB' };
  }

  // 2. 文件扩展名检查
  if (!file.name.toLowerCase().endsWith('.parquet') &&
      !file.name.toLowerCase().endsWith('.pq')) {
    return { valid: false, error: '仅支持 .parquet 或 .pq 文件' };
  }

  // 3. 路径遍历检查
  if (file.name.includes('..') || file.name.includes('\\')) {
    return { valid: false, error: '文件名包含非法字符' };
  }

  return { valid: true };
}
```

**单元测试覆盖**：
- `tests/security.test.ts:validateUploadedFile`（9 测试用例）

---

### 4. CORS 与浏览器安全策略（🟡 High）

**项目特定要求**: DuckDB-WASM 需要 COOP/COEP 头部

**检查项**：
- [ ] `Cross-Origin-Opener-Policy: same-origin`
- [ ] `Cross-Origin-Embedder-Policy: require-corp`
- [ ] CORS 配置正确（`vite.config.ts`）
- [ ] SharedArrayBuffer 可用（DuckDB-WASM 依赖）

**审查位置**：
```bash
# 检查 Vite 配置
cat vite.config.ts | grep -A 5 "headers"

# 检查生产构建配置
cat dist/index.html | grep -i "policy"
```

**当前配置**（`vite.config.ts:14-17`）：
```typescript
server: {
  headers: {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  },
},
```

**验证方法**：
1. 打开浏览器开发者工具 → Network → Headers
2. 检查响应头是否包含 COOP/COEP
3. 检查 Console 是否有 SharedArrayBuffer 警告

**常见问题**：
- ❌ 生产环境未配置 COOP/COEP（需在 Nginx/CDN 配置）
- ❌ COEP 值错误（`credentialless` vs `require-corp`）

---

### 5. React/TypeScript 前端安全（🟡 High）

**检查项**：
- [ ] XSS 防护：禁止 `dangerouslySetInnerHTML`
- [ ] 类型安全：严格的 TypeScript 配置
- [ ] 状态管理安全：敏感数据不存储在 localStorage
- [ ] 依赖安全：无已知漏洞（`bun audit`）
- [ ] CSP 配置（Content Security Policy）

**审查位置**：
```bash
# 搜索潜在的 XSS 风险
grep -r "dangerouslySetInnerHTML" src/
grep -r "innerHTML" src/
grep -r "outerHTML" src/

# 检查 localStorage 使用
grep -r "localStorage" src/
grep -r "sessionStorage" src/

# 检查 eval 使用
grep -r "eval(" src/
```

**示例问题**：
```tsx
// ❌ XSS 风险
<div dangerouslySetInnerHTML={{__html: userInput}} />

// ✅ 安全：React 自动转义
<div>{userInput}</div>

// ❌ 敏感数据存储
localStorage.setItem('policy_data', JSON.stringify(policyDetails));

// ✅ 仅存储非敏感数据
localStorage.setItem('theme', 'dark');

// ❌ 使用 eval
const result = eval(userInput);

// ✅ 使用安全的替代方案
const result = JSON.parse(userInput);
```

**TypeScript 配置检查**（`tsconfig.json`）：
```json
{
  "compilerOptions": {
    "strict": true,              // ✅ 严格模式
    "noImplicitAny": true,       // ✅ 禁止隐式 any
    "strictNullChecks": true,    // ✅ 严格空值检查
    "noUnusedLocals": true,      // ✅ 禁止未使用的变量
    "noUnusedParameters": true   // ✅ 禁止未使用的参数
  }
}
```

---

### 6. 数据隐私保护（🟡 High）

**项目特定要求**: 保护保单号（policy_no）等敏感信息

**检查项**：
- [ ] 保单号不能在 SELECT 列表（仅 WHERE 可用）
- [ ] 日志不包含敏感信息（保单号、业务员ID）
- [ ] 错误消息不泄露敏感数据
- [ ] 数据导出需聚合（禁止明细导出）

**审查位置**：
```bash
# 检查日志输出
grep -r "console.log" src/ --include="*.ts" --include="*.tsx"
grep -r "console.error" src/

# 检查导出功能
grep -r "export" src/ --include="*.ts" --include="*.tsx"
grep -r "download" src/
```

**示例问题**：
```typescript
// ❌ 日志泄露敏感信息
console.log('保单详情:', { policy_no: '123456', salesman_name: '张三' });

// ✅ 脱敏日志
console.log('保单详情:', { policy_no: maskPolicyNo('123456'), salesman_name: '张三' });

// ❌ 错误消息泄露
throw new Error(`保单 ${policy_no} 不存在`);

// ✅ 通用错误消息
throw new Error('保单不存在');

// ❌ 明细导出
const data = await query('SELECT policy_no, premium FROM PolicyFact');
downloadCSV(data);

// ✅ 聚合导出
const data = await query('SELECT salesman_name, SUM(premium) FROM PolicyFact GROUP BY salesman_name');
downloadCSV(data);
```

---

### 7. Worker 通信安全（🟡 Medium）

**项目特定架构**: DuckDB-WASM 在 Worker 中运行

**检查项**：
- [ ] Worker 消息验证（postMessage）
- [ ] Arrow IPC 格式验证
- [ ] Worker 错误处理
- [ ] 禁止 eval/Function 在 Worker 中

**审查位置**：
```bash
# 检查 Worker 实现
cat src/shared/duckdb/worker.ts

# 检查 postMessage 使用
grep -r "postMessage" src/
grep -r "onmessage" src/
```

**示例问题**：
```typescript
// ❌ 未验证的 Worker 消息
worker.onmessage = (event) => {
  const result = event.data;
  // 直接使用，未验证
  processData(result);
};

// ✅ 验证 Worker 消息
worker.onmessage = (event) => {
  const result = event.data;

  if (!result || typeof result !== 'object') {
    console.error('Invalid worker message');
    return;
  }

  if (result.error) {
    handleError(result.error);
    return;
  }

  processData(result.data);
};
```

---

### 8. 依赖包安全（🟡 Medium）

**检查项**：
- [ ] 无已知漏洞的依赖（`bun audit`）
- [ ] 依赖版本固定（不使用 `*` 或 `latest`）
- [ ] 定期更新依赖（每月检查）
- [ ] 生产依赖最小化

**执行检查**：
```bash
# 依赖漏洞扫描
bun audit

# 检查过期包
bun outdated

# 检查未使用的依赖
bun run depcheck

# 查看依赖树
bun pm ls
```

**关键依赖审查**：
```bash
# 检查 DuckDB-WASM 版本
grep "@duckdb/duckdb-wasm" package.json

# 检查 React 版本
grep "\"react\"" package.json

# 检查构建工具版本
grep "vite" package.json
```

---

### 9. 错误处理与信息泄露（🟢 Low）

**检查项**：
- [ ] 不暴露堆栈跟踪给用户
- [ ] 详细错误记录在 Console（不在 UI）
- [ ] 统一错误处理机制
- [ ] 错误边界（React Error Boundary）

**审查位置**：
```bash
# 检查错误处理
grep -r "try {" src/ --include="*.ts" --include="*.tsx"
grep -r "catch" src/

# 检查错误边界
grep -r "ErrorBoundary" src/
grep -r "componentDidCatch" src/
```

**示例问题**：
```tsx
// ❌ 泄露详细错误
catch (error) {
  toast.error(`数据库错误: ${error.message}\n${error.stack}`);
}

// ✅ 通用错误消息
catch (error) {
  console.error('Database error:', error); // 开发者可见
  toast.error('数据加载失败，请重试'); // 用户可见
}
```

---

### 10. 生产构建安全（🟢 Low）

**检查项**：
- [ ] Source maps 不暴露（生产环境）
- [ ] 环境变量安全管理
- [ ] 生产模式构建（`NODE_ENV=production`）
- [ ] 代码压缩和混淆

**审查位置**：
```bash
# 检查构建配置
cat vite.config.ts | grep -i "sourcemap"

# 检查生产构建
bun run build
ls -lh dist/
```

**Vite 生产配置**：
```typescript
export default defineConfig({
  build: {
    sourcemap: false, // ✅ 生产环境禁用 sourcemap
    minify: 'esbuild', // ✅ 代码压缩
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom'], // ✅ 代码分割
        },
      },
    },
  },
});
```

---

## 审查流程

### 1. 自动扫描（5 分钟）

**执行命令**：
```bash
# TypeScript 类型检查
bun run tsc --noEmit

# ESLint 静态分析
bun run eslint src/ --ext .ts,.tsx

# 依赖漏洞扫描
bun audit

# 单元测试（安全相关）
bun test tests/security.test.ts
bun test tests/sql-validator.test.ts

# 搜索敏感关键词
grep -r "password\|secret\|api_key" src/ --include="*.ts" --include="*.tsx"
```

---

### 2. 代码审查（10-15 分钟）

**审查优先级**：
1. **🔴 Critical**: SQL 注入、文件上传、SQL 验证器
2. **🟡 High**: CORS 配置、XSS 防护、数据隐私
3. **🟢 Medium/Low**: 依赖安全、错误处理、构建配置

**审查方法**：
- 逐文件检查上述清单
- 标记潜在问题（Critical/High/Medium/Low）
- 提供修复建议（代码示例）
- 交叉检查单元测试覆盖

---

### 3. 生成报告

**报告结构**：
```markdown
# 车险业绩看板安全审查报告

**审查时间**: {timestamp}
**审查范围**: {files_count} 个文件
**审查者**: Claude Code

---

## 📊 概览

| 指标 | 数值 |
|------|------|
| 审查文件 | 15 个 |
| 发现问题 | 0 Critical / 2 High / 3 Medium / 1 Low |
| 合规性评分 | 85/100 |
| 测试覆盖率 | 89 测试用例 |

---

## 🔴 Critical 问题（0）

无 Critical 问题

---

## 🟡 High 问题（2）

### High-1: localStorage 存储敏感数据

**文件**: `src/features/dashboard/PremiumDashboard.tsx:234`

**问题**:
```typescript
localStorage.setItem('lastQuery', JSON.stringify(queryResult));
```

**风险**: 查询结果可能包含敏感数据（业务员业绩），存储在 localStorage 可被其他脚本访问

**修复建议**:
```typescript
// 方案 1: 仅存储非敏感元数据
localStorage.setItem('lastQueryTime', new Date().toISOString());

// 方案 2: 使用 sessionStorage（页面关闭后清除）
sessionStorage.setItem('lastQuery', JSON.stringify(queryResult));

// 方案 3: 不持久化敏感数据
// 使用组件 state 或 React Context
```

**严重性**: High（数据泄露风险）
**修复优先级**: 本周内修复

---

### High-2: 错误消息泄露 SQL 查询

**文件**: `src/shared/duckdb/client.ts:156`

**问题**:
```typescript
catch (error) {
  throw new Error(`SQL 执行失败: ${sql}\n${error.message}`);
}
```

**风险**: 错误消息包含完整 SQL 查询，可能暴露表结构和业务逻辑

**修复建议**:
```typescript
catch (error) {
  // 开发环境：详细日志
  if (import.meta.env.DEV) {
    console.error('SQL execution error:', { sql, error });
  }

  // 生产环境：通用错误
  throw new Error('数据查询失败，请重试');
}
```

**严重性**: High（信息泄露）
**修复优先级**: 本周内修复

---

## 🟢 Medium 问题（3）

### Medium-1: 依赖包版本不固定

**文件**: `package.json`

**问题**:
```json
{
  "dependencies": {
    "react": "^18.3.1"  // ^ 符号允许小版本更新
  }
}
```

**风险**: 依赖包自动更新可能引入破坏性变更或安全漏洞

**修复建议**:
```json
{
  "dependencies": {
    "react": "18.3.1"  // 固定版本
  }
}
```

**严重性**: Medium（供应链风险）
**修复优先级**: 下次发版前修复

---

## 🟢 Low 问题（1）

### Low-1: Console.log 残留

**文件**: `src/features/sql-query/SqlQueryPanel.tsx:89`

**问题**:
```typescript
console.log('Query result:', result);
```

**风险**: 生产环境日志泄露数据（轻微）

**修复建议**:
```typescript
// 仅在开发环境输出
if (import.meta.env.DEV) {
  console.log('Query result:', result);
}
```

**严重性**: Low（信息泄露）
**修复优先级**: 下次迭代修复

---

## ✅ 已实现的安全措施（良好）

1. **SQL 注入防护** ✅
   - `sanitizeInput()`: 输入清理
   - `validateFilterInput()`: 白名单验证
   - `buildSafeLikeClause()`: 安全 LIKE 构建
   - 单元测试覆盖: 74 个测试用例

2. **SQL 验证器** ✅
   - 只读限制（禁止 DDL/DML）
   - PolicyFact 边界（禁止 raw_parquet）
   - 隐私保护（policy_no 明细禁止）
   - 聚合要求（必须聚合或 GROUP BY）
   - 单元测试覆盖: 62 个测试用例

3. **文件上传安全** ✅
   - 文件类型验证（仅 .parquet/.pq）
   - 文件大小限制（50MB）
   - 路径遍历防护
   - 单元测试覆盖: 9 个测试用例

4. **CORS 配置** ✅
   - COOP: same-origin
   - COEP: require-corp
   - SharedArrayBuffer 支持

5. **TypeScript 严格模式** ✅
   - strict: true
   - noImplicitAny: true
   - strictNullChecks: true

---

## 💡 改进建议

### 建议 1: 添加 Content Security Policy（优先级: Medium）

**问题**: 缺少 CSP 头部，XSS 攻击缺乏额外防护层

**建议**:
```typescript
// vite.config.ts
server: {
  headers: {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
    ].join('; '),
  },
},
```

**预期效果**: 增强 XSS 防护，符合安全最佳实践

---

### 建议 2: 实现 React Error Boundary（优先级: Low）

**问题**: 组件错误可能导致整个应用崩溃

**建议**:
```tsx
// src/shared/components/ErrorBoundary.tsx
class ErrorBoundary extends React.Component {
  componentDidCatch(error: Error) {
    console.error('App error:', error);
    // 不向用户显示详细错误
  }

  render() {
    if (this.state.hasError) {
      return <div>应用遇到错误，请刷新页面</div>;
    }
    return this.props.children;
  }
}
```

**预期效果**: 提升用户体验，避免错误信息泄露

---

### 建议 3: 生产环境禁用 Source Maps（优先级: Low）

**问题**: Source maps 可能泄露源码结构

**建议**:
```typescript
// vite.config.ts
export default defineConfig({
  build: {
    sourcemap: false, // 生产环境禁用
  },
});
```

**预期效果**: 减少源码泄露风险

---

## 🎯 合规性评分: 85/100

**评分依据**:
- SQL 注入防护: 20/20 ✅
- 文件上传安全: 15/15 ✅
- 数据隐私保护: 15/15 ✅
- 前端安全: 12/15 ⚠️（缺少 CSP、Error Boundary）
- 依赖安全: 8/10 ⚠️（版本不固定）
- 错误处理: 7/10 ⚠️（错误消息泄露）
- CORS 配置: 10/10 ✅
- 生产构建: 8/10 ⚠️（Source maps）

**总结**: 项目安全基础扎实，主要需改进错误处理和 CSP 配置

---

## 📋 修复优先级

| 优先级 | 问题数 | 修复时间 |
|--------|--------|---------|
| Critical | 0 | - |
| High | 2 | 本周内 |
| Medium | 3 | 下次发版 |
| Low | 1 | 下次迭代 |

---

## 🔧 自动化工具输出

### TypeScript 类型检查
\`\`\`
$ bun run tsc --noEmit
✅ No errors found
\`\`\`

### ESLint 静态分析
\`\`\`
$ bun run eslint src/ --ext .ts,.tsx
✅ No errors, 3 warnings (unused imports)
\`\`\`

### 依赖漏洞扫描
\`\`\`
$ bun audit
✅ No known vulnerabilities
\`\`\`

### 单元测试（安全）
\`\`\`
$ bun test tests/security.test.ts tests/sql-validator.test.ts
✅ 136 tests passed (0 failed)
\`\`\`

---

**报告完成** ✅
```

---

## 自动化工具

### TypeScript 类型检查
```bash
bun run tsc --noEmit
```

### ESLint 静态分析
```bash
bun run eslint src/ --ext .ts,.tsx
```

### 依赖漏洞扫描
```bash
bun audit
```

### 单元测试（安全相关）
```bash
bun test tests/security.test.ts
bun test tests/sql-validator.test.ts
```

### 搜索敏感关键词
```bash
# 硬编码密码
grep -r "password.*=" src/ --include="*.ts" --include="*.tsx"

# API 密钥
grep -r "api_key\|apiKey\|API_KEY" src/

# SQL 拼接
grep -r "WHERE.*\${" src/ --include="*.ts" --include="*.tsx"

# XSS 风险
grep -r "dangerouslySetInnerHTML" src/

# 敏感日志
grep -r "console.log" src/ | grep -E "policy_no|保单号"
```

---

## 严重性定义

### 🔴 Critical（立即修复）
- SQL 注入漏洞
- 文件上传漏洞（路径遍历）
- SQL 验证器绕过
- 硬编码密钥/密码
- 未授权数据访问

### 🟡 High（本周内修复）
- XSS 漏洞
- 敏感数据存储（localStorage）
- CORS 配置错误
- 错误消息泄露敏感信息
- 缺少重要安全头部

### 🟢 Medium（下次发版修复）
- 依赖包版本不固定
- 缺少 Error Boundary
- 日志包含敏感信息
- 缺少 CSP 头部

### 🟢 Low（下次迭代修复）
- Console.log 残留
- Source maps 暴露
- 代码质量问题
- 过时的依赖（无漏洞）

---

## 执行

现在请对以下文件执行安全审查：

**目标**: $ARGUMENTS（如未指定，审查所有变更文件）

**审查步骤**：
1. 运行自动化工具（类型检查、ESLint、依赖扫描）
2. 执行手动代码审查（按优先级检查 10 项清单）
3. 生成详细报告（问题清单 + 修复建议 + 合规性评分）
4. 提供修复优先级和时间线

**输出格式**: Markdown 报告（GitHub Flavored Markdown）
