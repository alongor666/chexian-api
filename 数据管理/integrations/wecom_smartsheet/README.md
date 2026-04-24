# 企业微信智能表格同步（多实例）

本模块把数据湖中各分支机构的商业险续保追踪名单同步到对应的企业微信智能表格。属于外部系统集成，**不参与 `daily.mjs` 主 ETL 产物生成**；由 `daily.mjs` 步骤 8 在 ETL 结束后按开关触发。

## 数据源

- 保单明细：`数据管理/warehouse/fact/policy/current/*.parquet`
- 报价数据：`数据管理/warehouse/fact/quotes_conversion/latest.parquet`
- 业务员团队：`数据管理/warehouse/dim/salesman/latest.parquet`
- 续保模式参考：`数据管理/warehouse/fact/renewal/renewal_funnel_2026q1.parquet`

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
| 续保模式 | `renewal_funnel_2026q1.renewal_mode`，无匹配为 `未分类` |

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

## 自动化（推荐）

ETL 结束后自动遍历所有 `config.*.json`：

```bash
# 1) 写入 .env.local 并置 WECOM_SMARTSHEET_ENABLED=1
# 2) 跑日常 ETL
node 数据管理/daily.mjs        # 或 /daily-sync 命令
# → 步骤 7 同步 VPS + 快照
# → 步骤 8 遍历 config.zigong.json / config.tianfu.json 推送企业微信
```

**失败策略**：单个实例 webhook 失败降级告警不阻塞 ETL（其他实例照常执行）。

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
