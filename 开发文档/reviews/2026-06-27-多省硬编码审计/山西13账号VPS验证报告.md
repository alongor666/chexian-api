# 山西分公司 13 账号 VPS 生产验证报告

- 环境：https://chexian.cretvalu.com（生产，全程只读）
- 方法：每账号一个 Agent（13 并行）跑 V1–V8（登录→自助签 PAT→路由目录→逐路由 Web 入口→Web/cx-cli 双入口对照→筛选器数据隔离→越权探测→吊销 PAT），关键结论由主控串行限速复测去噪。
- 日期：2026-06-27

## 一、总体结论

- **数据权限隔离合格（无 P0 串读）**：13/13 账号 `scLeak=false`。机构号只见本机构（如大同只见"全部/大同"），两个分公司超管（sxadmin/yangjie0621）见全部 11 个山西经营单元，**无一例看到四川机构数据**。
  - ⚠️ **前提与边界**：此"无串读"是**生产实测**结果，前提为生产 `BRANCH_RLS_ENABLED=on`（隔离条件下推得，cutover SOP 要求 on）。SQL findings 中 `quote/customer-flow` 在 **flag-off** 时 `permissionFilter='1=1'` 可致 branch_admin 串读 SC+SX，属**理论风险**，未被本次 flag-on 实测覆盖；若生产 flag 状态变更或某路由未消费 RLS，需重测。
- **Web 与 cx-cli 双入口无真实差异**：干净采集账号（大同）对照 43 条路由 `diff=0`；其余账号的 `diff>0` 经复测全部证实为**限流测量噪音**（非数据不一致）。
- **登录/PAT 链路可用**：13/13 登录成功；PAT 自助签发+吊销正常（`/api/auth/tokens` + `ttlDays∈{30,90,180,365}`）。个别 Agent 报"PAT 失败"系其误用了不存在的 `/api/auth/pat/create` 路由，非产品缺陷。

## 二、确认的真实问题（已去噪复测）

| 级别 | 问题 | 证据 | 层 |
|---|---|---|---|
| P1 | **后端未强制页面白名单（纵深防御缺失）** | org_user `allowedRoutes` 仅含 `/performance-analysis,/growth,/specialty`（前端守卫）。后端对 `/cost`、`/premium-report`、`/plan-achievement`、`/salesman-ranking` 等非白名单路由无路由级拦截：org_user 直接调用即 200+数据。**数据经 RLS 限本机构（大同调 /salesman-ranking 返回 10 条全是"大同"，无串读）**，故定 P1 非 P0。 | 权限/鉴权 |
| P1 | **业绩分析页子板块对 SX 故障** | `/performance-drilldown`、`/performance-bundle` 带正确参数仍持续 **400 + 零字节响应体**（前端无法解析错误）。命中 org_user 核心页 `/performance-analysis`。 | SQL/查询 |
| P1 | **报价转化页 + 客户来源页对 SX 报错** | `/quote-conversion/*`、`/customer-flow/*` 报 `列不存在：policy_date`，整页不可用。**根因待最终定位**：SQL 生成器本身不引用 `policy_date`（用 `quote_time`/`insurance_start_date`），疑在 VIEW/JOIN/cache 层或 flag-off 串读路径——需进一步定位再修。 | 数据/查询 |
| P1 | **生产 reload 冷启动期全站 502 数分钟** | 验证开始时遇全站 502；确诊为 app 启动串行预热 `CrossSellDailyAgg` 66 个月度批次（每批~2.7s，~3 分钟）期间 nginx 上游无响应。原生模块/进程正常（↺=0），非 bcrypt 地雷。无 readiness 网关/优雅切换。 | 部署/可用性 |
| P2 | **org_user `allowedRoutes` 生产缺 `/home`** | 生产登录返回 `["/performance-analysis","/growth","/specialty"]`，源码 `ORG_ROLE_ALLOWED_ROUTES` 含 `/home`。生产配置与源码不一致，可能影响首页导航。 | 配置一致性 |
| P2 | **限流回落 per-IP（auth 前）** | 主查询限流中间件在 `authMiddleware` 之前执行，`req.user` 未注入 → `keyByPatOrUser` 回落到 IP。NAT 后同机构多用户共享 100/60s 桶，高频操作互相挤占。本次 13 账号同出口 IP 并发即触发。真人点击频率远低于脚本，实际影响待业务观察。 | 限流/中间件 |

## 三、已核查排除项（曾疑似，实为无问题或测量噪音）

- **"慢路由 12–14s"** → 限流期并发轰炸 + 429 排队所致；单请求复测 sxadmin 全省 `claims-detail/pending-overview` 冷 0.28s/热 0.12s、`comprehensive-bundle` 冷 0.58s/热 0.21s，性能正常。⚠️ 单请求复测仅排除本次脚本污染，**未覆盖限流期外全部账号/43 路由**——暂按噪音处理，**保留慢查询观察项**。
- **"双入口 compare diff"** → 全部限流假阳性，真实 `diff=0`。
- **"visibleOrganizations 空"** → 限流期 `/api/filters/options` 被拒，真实隔离正确。
- **sx_taiyuan2「含历史停用机构」** → Agent 直查 Parquet（2021-01~2026-06-17）未见僵尸机构/零保费历史条目混入；近期 `org_level_3="其他"` 系正常外勤渠道编码。基本排除。
- **"/specialty 404"** → `/specialty` 是前端页面路由，非 `/api/query` 路由，Agent 误测。

## 四、方法论诚实声明

13 Agent 同出口 IP 并发 + 每脚本 120+ 请求触发全局限流，污染了多数账号脚本采集的后半段。**所有写入产品 backlog 的结论均经主控串行限速复测确认**，限流噪音类信号已剔除。若需更高置信度的全路由逐筛选覆盖，应改为：单 IP 串行、账号间隔、或申请限流白名单后重跑。
