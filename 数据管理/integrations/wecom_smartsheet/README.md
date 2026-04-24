# 企业微信智能表格同步

本模块负责把数据湖中的自贡商业险续保追踪名单同步到企业微信智能表格。它属于外部系统集成，不参与 `daily.mjs` 主 ETL 产物生成。

## 数据源

- 保单明细：`数据管理/warehouse/fact/policy/current/*.parquet`
- 报价数据：`数据管理/warehouse/fact/quotes_conversion/latest.parquet`
- 业务员团队：`数据管理/warehouse/dim/salesman/latest.parquet`
- 续保模式参考：`数据管理/warehouse/fact/renewal/renewal_funnel_2026q1.parquet`

## 当前筛选口径

- `三级机构 = 自贡`
- `险类 = 商业保险`
- `保险止期` 在 `2026-03-31` 至 `2026-05-30`
- `保费 > 300`
- 唯一键：`车架号`

报价状态按 VIN 匹配 `quotes_conversion/latest.parquet` 的最新商业险报价。续回状态按 `2026 保单 renewal_policy_no = 原保单 policy_no` 且 VIN 相同匹配。

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
| 流失原因分析 | 客户状态短标签。未续回且已进入报价期的记录顺序为到期状态、报价/涨价状态、续回状态，例如 `已过期、未报价、未续回`、`已过期、涨价25%、未续回`、`5天后到期、未涨价、未续回`；已续回记录不标注是否过期。超过 30 天未到报价期时只写 `未到报价期`，不写涨价情况和未续回 |
| 续保模式 | `renewal_funnel_2026q1.renewal_mode`，无匹配为 `未分类` |

## 状态文件

`state/zigong_vin_record_map.json` 保存 `车架号 -> record_id` 映射，是后续 `update_records` 的依据。该文件是运行态状态，默认被 `.gitignore` 忽略，不提交仓库。

## 环境变量

Webhook 不写入代码或配置文件明文。运行前设置：

```bash
export WECOM_SMARTSHEET_WEBHOOK_URL='https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=...'
```

## 运行

先 dry-run 查看新增、更新和移出名单，不调用企业微信：

```bash
python3 数据管理/integrations/wecom_smartsheet/sync_zigong_renewal.py --dry-run
```

正式同步：

```bash
python3 数据管理/integrations/wecom_smartsheet/sync_zigong_renewal.py
```

使用自定义配置：

```bash
python3 数据管理/integrations/wecom_smartsheet/sync_zigong_renewal.py \
  --config 数据管理/integrations/wecom_smartsheet/config.example.json \
  --dry-run
```

## 更新策略

- 本地状态已有车架号：走 `update_records`
- 本地状态没有车架号：走 `add_records`，并把返回的 `record_id` 写回状态文件
- 已在状态文件但不再符合筛选口径的车架号：本次只写入日志 `missing_vins`，不自动删除

## 频率限制

企业微信智能表格 Webhook 有分钟级限制：

- 单个工作表累计添加/更新记录不能超过 `3000 条/分钟`
- 单个智能表格文档所有 Webhook 累计添加/更新记录不能超过 `10000 条/分钟`

脚本默认按工作表 `3000 条/分钟` 控制。超过限制时会拆成多个分钟窗口，窗口之间等待 `60` 秒。配置项：

```json
{
  "sheet_records_per_minute_limit": 3000,
  "doc_records_per_minute_limit": 10000,
  "rate_limit_sleep_seconds": 60
}
```

如需删除或标记“移出名单”，需要先在企业微信表格增加对应字段，再把处理策略显式加入配置。

## 日志

每次运行会在 `logs/sync_YYYYMMDD_HHMMSS.json` 留一份摘要，包含源记录数、待新增、待更新、已报价、已续回和移出名单。
