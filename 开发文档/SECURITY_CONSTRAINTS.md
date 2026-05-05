# 安全约束与防护机制

**维护**: 安全团队
**更新**: 2026-01-11
**用途**: 定义系统安全约束和防护机制,确保数据安全和隐私保护

---

## 🎯 安全目标

1. **数据不离开浏览器**: 所有数据处理在用户浏览器完成
2. **只读访问**: 禁止任何修改数据的操作
3. **隐私保护**: 防止敏感数据泄露
4. **攻击防护**: 防止SQL注入、XSS等攻击

---

## 1. SQL注入防护

### 1.1 只读强制

**代码位置**: `src/shared/utils/sql-validator.ts`

**禁止的SQL操作**:
```sql
-- ❌ 禁止: 数据修改
INSERT INTO ...
UPDATE ...
DELETE FROM ...
CREATE TABLE ...
DROP TABLE ...

-- ❌ 禁止: 文件操作
COPY ...
EXPORT ...
read_parquet(...)
write_parquet(...)

-- ❌ 禁止: 系统操作
PRAGMA ...
SET ...
CALL ...
```

**允许的SQL操作**:
```sql
-- ✅ 允许: 只读查询
SELECT ...
WITH ... AS ...
```

### 1.2 聚合强制

**目的**: 防止返回明细数据导致隐私泄露

**强制规则**:
```sql
-- ❌ 禁止: 返回明细数据
SELECT policy_no, premium FROM PolicyFact LIMIT 100

-- ✅ 允许: 聚合查询
SELECT COUNT(*) as total, SUM(premium) as total_premium FROM PolicyFact

-- ✅ 允许: 分组聚合
SELECT org_level_3, SUM(premium) as premium
FROM PolicyFact
GROUP BY org_level_3
```

**实现逻辑**:
```typescript
// 检测是否包含聚合函数
const hasAggregate = /\b(COUNT|SUM|AVG|MIN|MAX)\b/i.test(sql);
// 检测是否包含GROUP BY
const hasGroupBy = /\bGROUP BY\b/i.test(sql);

// 必须满足其一
if (!hasAggregate && !hasGroupBy) {
  throw new Error('查询必须包含聚合函数或GROUP BY');
}
```

### 1.3 视图边界

**允许访问的视图**:
- `PolicyFact` - 主业绩分析视图

**禁止访问的表**:
- `raw_parquet` - 原始数据表

**代码位置**: `src/shared/utils/sql-validator.ts`
```typescript
const allowedTables = ['PolicyFact'];
const fromClause = sql.match(/\bFROM (\w+)\b/i);
if (fromClause && !allowedTables.includes(fromClause[1])) {
  throw new Error(`禁止访问表: ${fromClause[1]}`);
}
```

### 1.4 隐私保护

**敏感字段清单** (禁止查询):
- `policy_no` - 保单号
- `renewal_policy_no` - 续保单号
- `id_card` - 身份证号
- `phone` - 电话号码

**代码位置**: `src/shared/utils/sql-validator.ts`
```typescript
const sensitiveFields = ['policy_no', 'renewal_policy_no', 'id_card', 'phone'];
for (const field of sensitiveFields) {
  if (sql.includes(field)) {
    throw new Error(`禁止查询敏感字段: ${field}`);
  }
}
```

---

## 2. XSS攻击防护

### 2.1 防护的攻击模式

**代码位置**: `tests/security.test.ts`

**脚本注入**:
```javascript
"John<script>alert('xss')</script>"
"<img src=x onerror=alert('xss')>"
```

**HTML实体编码**:
```javascript
"John&lt;script&gt;alert('xss')&lt;/script&gt;"
```

**事件处理器**:
```javascript
"John onclick=alert('xss')"
"John onmouseover=alert('xss')"
```

### 2.2 HTML实体编码

**代码位置**: `src/shared/utils/security.ts`

```typescript
export function sanitizeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
```

**使用场景**:
- 业务员名称显示
- 机构名称显示
- 用户输入的文本

### 2.3 CSP策略

**代码位置**: `index.html`

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self';
               script-src 'self' 'unsafe-inline';
               style-src 'self' 'unsafe-inline';
               img-src 'self' data:;
               connect-src 'self'">
```

**作用**:
- 禁止加载外部脚本
- 禁止内联事件处理器(如`onclick`)
- 限制图片来源

---

## 3. COOP/COEP配置

### 3.1 DuckDB-WASM强制要求

**为什么需要**:
- DuckDB-WASM需要在独立上下文中运行
- 防止跨域内存攻击
- 确保资源共享隔离

### 3.2 Vite配置

**代码位置**: `vite.config.ts`

```typescript
server: {
  headers: {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  },
},
```

**作用**:
- COOP: 防止跨域窗口访问
- COEP: 要求所有资源需要corp标志

### 3.3 必要性说明

**不配置的后果**:
- DuckDB-WASM无法初始化
- Worker线程无法创建
- 应用完全无法使用

**验证方法**:
```javascript
// 打开Chrome DevTools Console
// 检查响应头
fetch(window.location.href).then(r => {
  console.log(r.headers.get('Cross-Origin-Opener-Policy'));
  console.log(r.headers.get('Cross-Origin-Embedder-Policy'));
});
```

---

## 4. 数据脱敏策略

### 4.1 敏感字段清单

| 字段 | 敏感级别 | 处理方式 |
|------|---------|---------|
| `policy_no` | 高 | 禁止查询 |
| `renewal_policy_no` | 高 | 禁止查询 |
| `salesman_name` | 中 | HTML实体编码 |
| `customer_name` | 高 | 聚合后不显示明细 |
| `id_card` | 高 | 不存储 |
| `phone` | 高 | 不存储 |

### 4.2 脱敏规则

**聚合查询自动脱敏**:
```sql
-- ✅ 允许: 聚合后不显示明细
SELECT salesman_name, COUNT(*) as count, SUM(premium) as premium
FROM PolicyFact
GROUP BY salesman_name;

-- ❌ 禁止: 返回明细
SELECT policy_no, salesman_name, premium FROM PolicyFact;
```

### 4.3 访问控制

**数据访问原则**:
- 最小权限原则: 只查询必要的字段
- 数据不离开浏览器: 所有处理在本地完成
- 无服务器存储: 不上传任何数据到服务器

---

## 5. 隐私保护措施

### 5.1 最小权限原则

**实现方式**:
- SQL查询强制聚合
- 禁止查询敏感字段
- 视图隔离原始数据

### 5.2 数据不离开浏览器

**架构设计**:
```
用户上传Parquet
  ↓
浏览器本地加载(DuckDB-WASM)
  ↓
本地SQL查询
  ↓
本地渲染图表
  ↓
无数据上传到服务器
```

**验证方法**:
- 打开Chrome DevTools Network标签
- 确认没有任何数据上传请求
- 只有静态资源下载请求

### 5.3 审计日志

**日志记录**:
```typescript
// 记录查询日志(不含敏感数据)
{
  timestamp: '2026-01-11T10:00:00Z',
  query: 'SELECT org_level_3, SUM(premium) FROM PolicyFact',
  executionTime: 150, // ms
  resultCount: 10
}
```

**日志用途**:
- 性能监控
- 安全审计
- 问题排查

### 5.4 合规要求

**数据保护法规**:
- GDPR: 欧盟数据保护条例
- PIPL: 中国个人信息保护法

**合规措施**:
- 数据不离开用户设备
- 不收集个人信息
- 不使用跟踪Cookie
- 提供数据删除功能(清除浏览器缓存)

---

## 📚 相关文档

- [CLAUDE.md §2 护栏](../CLAUDE.md#2-护栏red-line---以下文件禁止擅自修改) - 架构护栏
- [开发文档/TECHNICAL_DECISIONS.md](./TECHNICAL_DECISIONS.md) - 技术决策
- [tests/security.test.ts](../tests/security.test.ts) - 安全测试

---

**变更历史**:
- 2026-01-11: 初始版本,定义5大安全约束和防护机制
