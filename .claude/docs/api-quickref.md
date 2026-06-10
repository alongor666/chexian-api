# API 端点快速参考

> 所有 `/api/query/*` 和 `/api/data/*` 端点需要 JWT Token（`Authorization: Bearer <token>`）

**最后更新**: 2026-02-24

---

## 认证 `/api/auth`

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/api/auth/login` | 用户登录，返回 JWT Token | 无 |
| POST | `/api/auth/refresh` | 刷新 JWT Token | 需 Token |

**登录请求**:
```json
{ "username": "admin", "password": "<在凭据库/E2E_PASSWORD 环境变量中获取>" }
```
**登录响应**: `{ "success": true, "data": { "token": "eyJ..." } }`

---

## 查询 `/api/query`（全部需认证）

| 方法 | 路径 | 说明 | SQL 生成器 |
|------|------|------|-----------|
| GET | `/kpi` | KPI 汇总（保费、件数、占比） | `kpi.ts` |
| GET | `/kpi-detail` | KPI 明细（按维度分组） | `kpi-detail.ts` |
| GET | `/trend` | 时间趋势（月度/周度） | `trend.ts` |
| GET | `/quality-business-trend` | 质量业务趋势 | `trend.ts` |
| GET | `/salesman-ranking` | 业务员排名 | `salesman-ranking.ts` |
| GET | `/growth` | 增长率分析 | `growth.ts` |
| GET | `/cost` | 成本分析（赔付率/费用率） | `cost.ts` |
| GET | `/coefficient` | 商车自主定价系数 | `coefficient.ts` |
| GET | `/truck` | 营业货车专项分析 | `truck.ts` |
| GET | `/renewal` | 续保率分析 | `renewal.ts` |
| GET | `/renewal-drilldown` | 续保下钻分析 | `renewal-drilldown.ts` |
| GET | `/cross-sell` | 交叉销售分析 | `cross-sell.ts` |
| GET | `/cross-sell-summary` | 交叉销售汇总 | `cross-sell-summary.ts` |
| GET | `/marketing-report` | 营销报告 | `marketing-report.ts` |
| GET | `/premium-report` | 保费报告 | `premium-report.ts` |
| GET | `/premium-plan` | 保费计划 | `premiumPlan.ts` |
| GET | `/plan-achievement` | 计划达成率 | `premiumPlan.ts` |
| POST | `/custom` | 自定义 SQL 查询 | 用户输入 |
| GET | `/test` | 测试连接 | — |

**通用查询参数**（所有 GET 端点）:
```
startDate, endDate, orgLevel3, orgNames, salesmanName, salesmanNames,
insuranceType, vehicleType, businessType, renewalStatus
```

---

## 数据管理 `/api/data`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/upload` | 上传 Parquet/Excel 文件 |
| GET | `/files` | 列出已上传文件 |
| DELETE | `/files/:filename` | 删除文件 |
| GET | `/current` | 获取当前加载的数据文件信息 |
| POST | `/load` | 加载指定 Parquet 文件 |
| GET | `/schema` | 获取当前数据 Schema |

## AI `/api/ai`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/nl2sql` | 自然语言转 SQL（智谱 glm-4.7-flash） |
| POST | `/analyze` | 智能数据分析 |

## 筛选器 `/api/filters`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/options` | 获取所有筛选器选项（机构/业务员/险种等） |

---

## 快速验证

```bash
# 登录获取 Token
TOKEN=$(curl -s http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<在凭据库/E2E_PASSWORD 环境变量中获取>"}' | jq -r '.data.token')

# 查询 KPI
curl -s http://localhost:3000/api/query/kpi \
  -H "Authorization: Bearer $TOKEN" | jq '.data | length'

# 检查健康状态
curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/query/test \
  -H "Authorization: Bearer $TOKEN"
```
