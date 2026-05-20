# 企业微信智能表格同步（多实例）

本模块把数据湖中各分支机构的商业险续保追踪名单同步到对应的企业微信智能表格。属于外部系统集成，**不参与 `daily.mjs` 主 ETL 产物生成**；由 `daily.mjs` 步骤 8 在 ETL 结束后按开关触发。

## 数据源

- 保单明细：`数据管理/warehouse/fact/policy/current/*.parquet`
- 报价数据：`数据管理/warehouse/fact/quotes_conversion/latest.parquet`
- 业务员团队：`数据管理/warehouse/dim/salesman/latest.parquet`
- 续保模式：当前同步统一写入 `未分类`

## 多实例设计

每个 `config.{instance}.json` 对应一个机构/一张智能表格：

| 配置文件 | 机构 | 止期范围 | Webhook env |
|---|---|---|---|
| `config.zigong.json` | 自贡 | 2026-03-31 ~ 2026-05-30 | `WECOM_SMARTSHEET_WEBHOOK_ZIGONG` |
| `config.tianfu.json` | 天府 | 2026-03-31 ~ 2026-04-29 | `WECOM_SMARTSHEET_WEBHOOK_TIANFU` |

实例共享：险类 = 商业保险、保费 > 300、唯一键 = 车架号、速率限制 3000 条/分钟。

**state 与 log 按 instance 隔离**：
- `state/{instance_name}_vin_record_map.json`（`car frame no → record_id`，运行态、被 `.gitignore`）
- `logs/{instance_name}_sync_{YYYYMMDD_HHMMSS}.json`

## 同步字段

| 企业微信字段 | 数据来源 |
| --- | --- |
| 到期日 | `policy.insurance_end_date` |
| 三级机构 | `policy.org_level_3` |
| 销售团队 | `salesman.team`，无匹配时取报价团队或 `未分配` |
| 车牌号码 | `policy.plate_no` |
| 车架号 | `policy.vehicle_frame_no` |
| 客户类别 | `policy.customer_category` |
| 险别组合 | `policy.coverage_combination` |
| 是否报价 | 是否按 VIN 匹配到最新报价 |
| 上年折扣 | `policy.commercial_pricing_factor` |
| 上年保费 | `policy.premium` |
| 报价折扣 | 最新报价 `quotes_conversion.commercial_pricing_factor` |
| 报价保费 | 最新报价 `quotes_conversion.final_quote_premium` |
| 是否续回 | 是否按 `renewal_policy_no + VIN` 匹配到续保保单 |
| 业务员 | `policy.salesman_name`，按文本写入 |
| 流失原因分析 | 未续回按 (到期状态、报价/涨价状态、未续回) 组合；超过 30 天未到报价期只写 `未到报价期` |
| 续保模式 | 当前统一为 `未分类` |

## 环境变量（持久化到 `.env.local`）

```bash
# chexian-api/.env.local（git 已忽略）
WECOM_SMARTSHEET_ENABLED=1
WECOM_SMARTSHEET_WEBHOOK_ZIGONG='https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=...'
WECOM_SMARTSHEET_WEBHOOK_TIANFU='https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=...'
```

模板见 `chexian-api/.env.example`。`daily.mjs` 启动时轻量加载 `.env.local`（不依赖 dotenv 包）。

## 手动运行

```bash
# dry-run（不调用 webhook）
python3 数据管理/integrations/wecom_smartsheet/sync_renewal.py \
  --config 数据管理/integrations/wecom_smartsheet/config.zigong.json --dry-run

# 正式同步单个实例
python3 数据管理/integrations/wecom_smartsheet/sync_renewal.py \
  --config 数据管理/integrations/wecom_smartsheet/config.tianfu.json
```

### 机构表批量同步（xlsx 登记表）

机构续保追踪表 webhook 不写入仓库，日常从 iCloud 登记表读取：

```bash
# 默认 dry-run：只看新增/更新计划，不调用 webhook
python3 数据管理/integrations/wecom_smartsheet/sync_org_renewal_from_xlsx.py

# 确认 dry-run 后真实推送全部登记机构
python3 数据管理/integrations/wecom_smartsheet/sync_org_renewal_from_xlsx.py --execute

# 只补某几个机构
python3 数据管理/integrations/wecom_smartsheet/sync_org_renewal_from_xlsx.py --org 新都,资阳 --execute
```

默认登记表路径：
`/Users/alongor666/Library/Mobile Documents/com~apple~CloudDocs/续保追踪表链接与意见反馈.xlsx`

脚本复用 `instances/sichuan_*_2025_may_jul.yaml(.disabled)` 和
`state/*_vin_record_map.json`，因此每天重跑会按 VIN 状态自动区分
`update_records` 与 `add_records`，不会依赖 `.env.local` 中的旧 webhook。

## 自动化（推荐）

日常推荐走仓库的一键发布入口，完成 ETL、VPS 同步、PM2 reload、健康检查后，再同步机构续保追踪表：

多 webhook / 多智能表目标的当前登记、state、schema 与字段策略见
[`WEBHOOK_TARGETS.md`](./WEBHOOK_TARGETS.md)。新增或转让智能表时，先更新该目标登记，
再执行同步，避免误用旧 webhook、旧字段 ID 或旧 record_id state。

```bash
# 先看全流程计划，不执行外部写入
bun run release:daily:dry

# 真实 ETL/VPS/reload，但企微只 dry-run
bun run release:daily:check

# 日常真实发布：ETL → VPS → reload → /health → 机构续保表同步
bun run release:daily

# 只补某几个机构
node scripts/sync-and-reload.mjs --wecom --wecom-org 新都,资阳
```

企微同步读取 iCloud xlsx 登记表中的 webhook，不依赖 `.env.local` 中的旧 webhook。

**增量策略**：
- 本地 state 无 VIN：走 `add_records` 并保存 `record_id`
- 本地 state 有 VIN 但 payload hash 变化：走 `update_records`
- 本地 state 有 VIN 且 payload hash 未变化：跳过，不调用 webhook
- 已在 state 但不再符合筛选口径的 VIN：写入 `missing_vins`，不自动删除

**失败策略**：发布入口任一阶段失败会中止；单独跑企微 wrapper 时，会继续后续机构并在摘要里报告失败机构。

## 新增实例

1. 在当前目录新建 `config.{new_instance}.json`，指定 `instance_name`, `org_level_3`, 日期范围, `webhook_env`
2. 在 `.env.local` 追加对应 `webhook_env` 的 URL
3. 在 `.env.example` 登记 env 变量名（不含密钥）
4. 下次跑 `daily.mjs` 自动纳入

## 更新策略

- 本地状态已有车架号：走 `update_records`
- 本地状态没有车架号：走 `add_records`，并把返回的 `record_id` 写回状态文件
- 已在状态文件但不再符合筛选口径的车架号：本次只写入日志 `missing_vins`，不自动删除

## 频率限制

- 单工作表累计添加/更新 ≤ `3000 条/分钟`
- 单智能表格文档所有 Webhook 累计 ≤ `10000 条/分钟`

脚本默认按工作表 3000 条/分钟控制，超限自动拆窗口等待 60s。

## 日志

每次运行在 `logs/{instance_name}_sync_YYYYMMDD_HHMMSS.json` 留摘要，含源记录数、待新增、待更新、已报价、已续回、移出名单和 batch 响应状态。

## 故障排查

### 失败信号

- `daily.mjs` 步骤 8 控制台输出红字 `⚠ {instance} 同步失败` + 完整 errcode/errmsg
- 该实例的 `logs/{instance}_sync_*.json` 不会写入（因为脚本提前抛异常）
- ETL 不被阻塞：其他实例和 ETL 后续步骤照常完成

### 常见 errcode 对照表

| errcode | 含义 | 处理步骤 |
|---|---|---|
| `40036` / `field not found` | schema 声明的 fieldId 在表格中不存在 | (1) 企业微信智能表格界面找到对应字段，复制其 fieldId<br>(2) 对照 `sync_renewal.py` 的 `DEFAULT_SCHEMA`（35-52 行）<br>(3) 若字段被删/改 ID，更新 `DEFAULT_SCHEMA` 后重跑 |
| `60011` / `permission denied` | Webhook 权限不足 | (1) 企业微信后台检查 Webhook 是否被禁用/降级为只读<br>(2) 检查 `.env.local` 中的 `WECOM_SMARTSHEET_WEBHOOK_{INSTANCE}` URL 是否过期/被重置<br>(3) 重新生成 Webhook URL → 更新 `.env.local` → 重跑 |
| `45009` / `rate limit exceeded` | 超过分钟级限流 | (1) 检查 config 里 `sheet_records_per_minute_limit`（默认 3000）<br>(2) 同一文档下多个 Webhook 总和不能超 10000/分钟，多实例并发时降低单实例限速<br>(3) 脚本会自动等待 60s 重试，若长期触发说明数据量超模型设计（4000+），考虑拆分时间窗口 |
| `40058` / `record_id not found` | state 文件里的 record_id 在表格中已不存在 | 通常发生在销售人员手工删除了表格记录。处理：<br>(1) `cat state/{instance}_vin_record_map.json \| jq 'del(.records["LV..."])'` 删除有问题的 VIN 条目（或整体备份后清空 records 走全量重建）<br>(2) 重跑 sync，脚本会走 `add_records` 重建映射 |
| HTTP 4xx/5xx | 网络/企业微信侧故障 | 临时性失败，等下一轮 ETL 自动重试。若连续 3 轮失败，检查 webhook URL host 是否可达：`curl -I https://qyapi.weixin.qq.com/` |

### record_id not found 手动清理流程

当企业微信表格记录被人工删除导致后续 update 失败时：

```bash
INSTANCE=zigong  # 或 tianfu
STATE=数据管理/integrations/wecom_smartsheet/state/${INSTANCE}_vin_record_map.json
BACKUP=数据管理/integrations/wecom_smartsheet/state/${INSTANCE}_vin_record_map.bak.$(date +%Y%m%d).json

# 1. 备份
cp $STATE $BACKUP

# 2. 删除问题 VIN（替换 LV... 为日志中报错的车架号）
python3 -c "
import json, sys
with open('$STATE') as f: data = json.load(f)
problem_vins = ['LV12345...']  # 从错误日志摘取
for vin in problem_vins:
    data.get('records', {}).pop(vin, None)
with open('$STATE', 'w') as f: json.dump(data, f, ensure_ascii=False, indent=2)
print(f'已剔除 {len(problem_vins)} 个 VIN')
"

# 3. 重跑（被剔除的 VIN 走 add_records 重建）
python3 数据管理/integrations/wecom_smartsheet/sync_renewal.py \
  --config 数据管理/integrations/wecom_smartsheet/config.${INSTANCE}.json
```

### 整张表全量重建

当表格被整体重建/迁移（fieldId 全变）时，最快方式是清空 state + 在新表上重跑：

```bash
INSTANCE=tianfu

# 1. 备份后清空 state（不能直接删，state 文件路径要保留）
mv state/${INSTANCE}_vin_record_map.json state/${INSTANCE}_vin_record_map.bak.json
echo '{"summary":{},"records":{}}' > state/${INSTANCE}_vin_record_map.json

# 2. 更新 sync_renewal.py 的 DEFAULT_SCHEMA 为新表的 fieldId 映射

# 3. 重跑 add_records 全量
python3 sync_renewal.py --config config.${INSTANCE}.json
```

### 排查 Webhook 是否被禁用

如果某实例**所有**记录都失败，且 errcode 重复出现：

```bash
# 1. 直接调用 webhook ping（不推送数据，只验证连通性 + 权限）
curl -X POST "$WECOM_SMARTSHEET_WEBHOOK_TIANFU" \
  -H "Content-Type: application/json" \
  -d '{"schema":{},"add_records":[]}'

# 预期：返回 errcode=0 或参数错误（说明 webhook 活着）
# 故障：返回 60011/45009/网络错误（按上表处理）
```
