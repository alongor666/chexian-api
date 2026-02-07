# 🔧 错误修复指南

## 错误清单

### 1. ❌ 500 Internal Server Error
**原因**: DuckDB WASM文件加载失败

**解决方案**:

#### 方案A: 清理缓存并重启（最常见有效）
```bash
# 1. 停止所有开发服务器
pkill -f vite

# 2. 清理缓存和构建文件
rm -rf node_modules/.vite
rm -rf dist

# 3. 清理浏览器缓存
# 在浏览器中: Cmd+Shift+R (Mac) 或 Ctrl+Shift+R (Windows)

# 4. 重新启动
bun run dev
```

#### 方案B: 检查WASM文件加载
打开浏览器开发者工具（F12）→ Network标签，查找：

**✅ 应该看到的文件**:
```
✅ duckdb-browser-mvp.worker.js (200 OK)
✅ duckdb-mvp.wasm (200 OK)
✅ worker-D7g-umjv.js (200 OK)
```

**❌ 如果看到404或500错误**:
```bash
# 重新安装依赖
rm -rf node_modules
bun install

# 重新构建
bun run build
```

#### 方案C: 检查CORS头
```bash
# 检查服务器响应头
curl -I http://localhost:5173

# 应该包含:
# Cross-Origin-Opener-Policy: same-origin
# Cross-Origin-Embedder-Policy: require-corp
```

### 2. ⚠️ "Could not establish connection"
**原因**: 浏览器扩展错误（不影响功能）

**解决方案**:
- ✅ 忽略此错误
- 或禁用可能冲突的浏览器扩展

### 3. ℹ️ favicon.ico 404
**原因**: 缺少图标文件（不影响功能）

**解决方案**:
```bash
# 创建public目录
mkdir -p public

# 创建简单的SVG favicon
cat > public/favicon.svg << 'EOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <text y=".9em" font-size="90">📊</text>
</svg>
EOF

# 更新index.html
# <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
```

---

## 完整修复流程

### 步骤1: 完全清理环境
```bash
# 停止所有服务
pkill -f "vite|bun"

# 清理所有缓存
rm -rf node_modules/.vite
rm -rf dist
rm -rf bun.lockb

# 清理浏览器存储
# 在浏览器中打开 DevTools → Application →
# Clear storage → Clear site data
```

### 步骤2: 验证依赖
```bash
# 检查关键依赖
bun pm ls | grep duckdb
bun pm ls | grep arrow

# 如果缺失，重新安装
bun install
```

### 步骤3: 检查Vite配置
```bash
# 验证 vite.config.ts 包含必需的CORS头
cat vite.config.ts | grep -A5 "server:"
```

应该包含:
```typescript
server: {
  headers: {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  },
},
```

### 步骤4: 重启开发服务器
```bash
# 在项目根目录
bun run dev
```

查看输出:
```
➜  Local:   http://localhost:5173/
➜  Network: use --host to expose
➜  press h + enter to show help
```

### 步骤5: 浏览器测试
1. 打开 http://localhost:5173
2. 打开开发者工具（F12）
3. 检查Console标签 - 应该无错误
4. 检查Network标签 - 所有文件应该是200 OK

---

## 常见问题排查

### 问题: "SharedArrayBuffer is not defined"
**原因**: 缺少必需的CORS头

**修复**: 确保vite.config.ts配置正确（见步骤3）

### 问题: "Failed to fetch worker"
**原因**: Worker文件路径错误或WASM加载失败

**修复**:
```bash
# 检查worker文件
ls -la node_modules/@duckdb/duckdb-wasm/dist/

# 应该看到:
# duckdb-browser-mvp.worker.js
# duckdb-mvp.wasm
# duckdb-browser-eh.worker.js
# duckdb-eh.wasm
```

### 问题: "TypeError: tableToIPC is not a function"
**原因**: Apache Arrow版本不兼容

**修复**:
```bash
# 检查版本
bun pm ls | grep arrow

# 应该是: apache-arrow@17.0.0
# 如果不是，重新安装
bun remove apache-arrow
bun add apache-arrow@^17.0.0
```

---

## 永久解决方案

### 1. 添加开发脚本
```json
// package.json
{
  "scripts": {
    "dev": "vite",
    "dev:clean": "rm -rf node_modules/.vite && vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  }
}
```

### 2. 环境变量配置
```bash
# .env.local
VITE_DUCKDB_LOG_LEVEL=DEBUG
```

### 3. 错误边界处理
在Dashboard组件中添加错误边界：
```tsx
if (error) {
  return (
    <div className="bg-red-100 text-red-700 p-4 rounded">
      <h2 className="font-bold">加载失败</h2>
      <p>{error}</p>
      <button onClick={() => window.location.reload()}>
        刷新页面
      </button>
    </div>
  );
}
```

---

## 诊断命令

```bash
# 检查端口占用
lsof -i :5173

# 检查进程
ps aux | grep -E "vite|bun"

# 查看日志
tail -f ~/.bun-install/log/*.log

# 测试API
curl http://localhost:5173/src/app/main.tsx

# 检查WASM文件
curl -I http://localhost:5173/node_modules/@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm
```

---

## 联系支持

如果以上方案都无法解决问题，请收集以下信息:

1. **系统信息**:
```bash
uname -a
bun --version
node --version
```

2. **错误日志**:
   - 浏览器Console截图
   - Network标签截图
   - 终端输出

3. **环境信息**:
```bash
bun pm ls
cat vite.config.ts
```

---

## 最后手段

如果所有方法都失败：

```bash
# 完全重置项目
git clean -fdx
git reset --hard HEAD
bun install
bun run dev
```

⚠️ **警告**: 这会删除所有未提交的更改！
