# PAT (Personal Access Token) 使用指南

> 长期 Bearer Token 鉴权，强制只读，权限完全继承用户。给 CLI / MCP / Python 脚本 / Claude Desktop 用。

## 1. PAT 是什么

| 维度 | JWT（浏览器会话） | PAT（程序化访问） |
|------|----------------|-----------------|
| 来源 | 用户名+密码登录 | 在用户管理页生成 |
| 存储 | HttpOnly Cookie | 本地配置文件 / env / Claude 配置 |
| 时长 | 4 小时 + refresh | 30 / 90 / 180 / 365 天 |
| 写权限 | 完整（取决于角色） | **永远只读** |
| 限流 | 200/min（query） | 60/min |
| 失效 | 用户登出 | 主动吊销 / 过期 / 用户失活 |

**权限**：PAT 完全继承生成它的用户的 `allowedRoutes` / `dataScope` / `organization`。用户改权限 → PAT 立即同步。

**安全保证**：
- DB 只存 `bcrypt(secret)`，**明文 token 仅生成时返回一次**
- 强制只读：架构层中间件，**任何 POST/PUT/DELETE 都 403**，不能凭路由配置覆盖
- PAT 不能管理 PAT：`/api/auth/tokens` 端点拒绝 PAT 来源
- 用户失活时关联 PAT 立即失效

---

## 2. 生成 Token（Web UI）

1. 登录 `https://chexian.cretvalu.com`
2. 进入「用户与权限管理」→ 切到「我的 API Token」Tab
3. 填写 Token 名称（如 `claude-desktop-mac`）+ 选择有效期（推荐 90 天）
4. 点击「生成 Token」
5. **立即复制弹出的明文 token**，关闭后无法再次查看

Token 格式：`cx_pat_<8位ID>.<43位密钥>`（共 59 字符）

---

## 3. 在各种工具里使用

### 3.1 curl

```bash
TOKEN='cx_pat_AB12CD34.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
curl -H "Authorization: Bearer $TOKEN" \
  'https://chexian.cretvalu.com/api/query/kpi?year=2026' | jq .
```

### 3.2 Python（requests）

```python
import requests
TOKEN = 'cx_pat_AB12CD34.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
BASE = 'https://chexian.cretvalu.com'

resp = requests.get(
    f'{BASE}/api/query/kpi',
    headers={'Authorization': f'Bearer {TOKEN}'},
    params={'year': 2026, 'org_level_3': '分公司A'},
)
resp.raise_for_status()
print(resp.json()['data'])
```

### 3.3 cx CLI

安装：
```bash
# 项目根目录
bun install
cd cli && bun run build
# 全局软链（可选）
npm link
```

使用（v0.2.0 全能力版，完整命令表与退出码契约见 `cli/README.md`）：
```bash
cx login --token cx_pat_xxx.yyy   # 或交互式输入
cx whoami                          # 验证身份/数据范围/tokenId
cx routes --search 赔案            # 按 tag 分组列路由 + 关键词搜索
cx query KPI --year=2026 --org_level_3=分公司A
cx query /repair/overview          # path 直通（不依赖 catalog）
cx query PATROL --domain=renewal   # 带 path 参数路由（:domain 自动填充）
cx query TREND --granularity=week --format=csv > trend.csv
echo "SELECT org_level_3, SUM(premium) FROM PolicyFact GROUP BY 1" | cx sql -
cx filters --dimension org_level_3 # 维度可选值
cx data version                    # 数据新鲜度
cx health                          # 连通性诊断
cx config set baseUrl http://localhost:3000   # 切本地后端
cx completion zsh                  # shell 补全
```

退出码契约：`0` 成功 · `1` 通用错误 · `2` 鉴权失败 · `3` 权限不足 · `4` 用法错误 · `5` 限流。

环境变量优先级覆盖：
```bash
export CX_BASE_URL='https://chexian.cretvalu.com'
export CX_PAT='cx_pat_xxx.yyy'
cx query KPI   # 不需 cx login
```

### 3.4 Claude Desktop（stdio MCP）

在 `~/Library/Application Support/Claude/claude_desktop_config.json` 加：

```json
{
  "mcpServers": {
    "chexian": {
      "command": "npx",
      "args": ["-y", "@chexian/mcp"],
      "env": {
        "CX_BASE_URL": "https://chexian.cretvalu.com",
        "CX_PAT": "cx_pat_xxx.yyy"
      }
    }
  }
}
```

重启 Claude Desktop 后，对话框里就能看到 `cx_query_kpi` / `cx_query_trend` 等工具。直接问："看下分公司 A 上周 KPI"，Claude 会自动调用对应工具。

**Cursor / Cline / Continue 等其他 MCP 客户端**：配置方式类似，命令都是 `npx -y @chexian/mcp` + `CX_BASE_URL` + `CX_PAT`。

### 3.5 Excel / Power BI

Power Query → Web 数据源 → URL `https://chexian.cretvalu.com/api/query/kpi?year=2026` + Authorization header `Bearer cx_pat_xxx.yyy`。

---

## 4. 安全建议

1. **不要把 Token 提交到 Git**：用 `.env` 或 OS Keychain，确保 `.gitignore` 覆盖
2. **90 天轮换**：到期前在 Web UI 生成新 Token，更新各处配置后吊销旧的
3. **离职/换岗**：管理员把用户 disable 后，关联 PAT 立即失效，无需逐个吊销
4. **泄露应急**：在「我的 API Token」立即吊销 → 服务端 401 立即生效
5. **MCP 配置**：尽量用 macOS Keychain / 1Password CLI 把 `CX_PAT` 注入 env，不要明文写在 JSON 里
6. **共享 Token 是反模式**：每个用户/服务/客户端用独立 Token，便于审计追溯

---

## 5. 故障排查

| 现象 | 含义 | 处理 |
|------|------|------|
| HTTP 401 Invalid PAT format | Token 不以 `cx_pat_` 开头或长度不对 | 检查复制是否完整 |
| HTTP 401 Invalid PAT | Token 不存在或被替换 | 重新生成 |
| HTTP 401 PAT expired | 已过有效期 | 重新生成 |
| HTTP 401 PAT has been revoked | 被吊销 | 重新生成 |
| HTTP 403 Account disabled | 用户被管理员禁用 | 找管理员 |
| HTTP 403 PAT is read-only | 用 PAT 调了 POST/PUT/DELETE | 改用浏览器会话操作 |
| HTTP 403 Cannot manage tokens via PAT | 想用 PAT 管理 PAT | 改用浏览器会话登录后操作 |
| HTTP 429 + Retry-After | 触发 60/min 限流 | sleep 后重试，或降低脚本频率 |

服务端审计日志：`logs/audit.log` 每行 JSON，`auth_kind=pat` + `token_id=xxx` 可定位某 PAT 的所有调用。

---

## 6. 路线图

- [ ] 普通用户独立 `/settings/api-tokens` 页面（当前 admin only）
- [ ] PAT 创建时支持额外的 `scopes` 收窄（比用户权限更严）
- [ ] 行级水印：返回数据嵌入 `_trace_id`，泄露可溯源
- [ ] 单 PAT 每日行数上限 + 告警
