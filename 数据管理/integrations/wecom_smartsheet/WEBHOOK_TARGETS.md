# 企业微信智能表格目标管理

> 目标：让 webhook、字段 schema、state、同步口径一一绑定，避免同一脚本误用旧地址、旧字段或旧 record_id。

## 当前有效目标

| target_id | 用途 | webhook 来源 | state | schema | 默认同步字段 | 观察字段 |
|---|---|---|---|---|---|---|
| `renewal_may_2026_6fDmy0` | 续保 5 月表 | `.env.local:WECOM_SMARTSHEET_WEBHOOK_RENEWAL_MAY` | `state/renewal_2026_may_jul_vin_record_map_6fDmy0.json` | `outputs/renewal_may_jul_schema_6fDmy0.json` | 是否成交、是否报价、自主系数 | 风险等级、流失公司 |
| `org_renewal_2025_may_jul` | 各三级机构续保表 | iCloud 登记表 `续保追踪表链接与意见反馈.xlsx` | `state/sichuan_*_2025_may_jul_vin_record_map.json` | 各机构 YAML/脚本默认 schema | 续保追踪字段 | 资阳未匹配业务员 |
| `postal_policy_all_since_20260420` | 邮政全量保单表 | `.env.local:WECOM_SMARTSHEET_WEBHOOK_POSTAL_ALL` | `state/postal-policy-all-since-20260420_synced_keys.json` | `instances/postal-policy-since-20260420.yaml` | 增量 add-only；只写原 12 个字段 | 新表新增字段不写入 |
| `shanxi_postal_all` | 山西邮政/邮储经代签单全量表 | `.env.local:WECOM_SMARTSHEET_WEBHOOK_SX_POSTAL` | `state/shanxi-postal-all_synced_keys.json` | `instances/shanxi-postal-all.yaml` | 增量 add-only；四川 12 字段 + 经代名(简称)；省份隔离 branch_code='SX' | 业务员姓名/投保人/图片字段无源留空 |

废弃的续保 5 月 state 已移动到 `state/deprecated/`，不要再作为默认入口使用。

## 日常命令

续保 5 月默认只同步稳定字段，避免单选项缺失阻塞报价更新：

```bash
python3 数据管理/integrations/wecom_smartsheet/sync_may_renewal_fields.py sync --province SC
python3 数据管理/integrations/wecom_smartsheet/sync_may_renewal_fields.py sync --province SC --execute
```

观察风险等级/流失公司，不建议直接执行：

```bash
python3 数据管理/integrations/wecom_smartsheet/sync_may_renewal_fields.py sync --province SC --fields all
```

各三级机构续保：

```bash
python3 数据管理/integrations/wecom_smartsheet/sync_org_renewal_from_xlsx.py
python3 数据管理/integrations/wecom_smartsheet/sync_org_renewal_from_xlsx.py --execute
```

## 后续治理形态

建议把所有目标统一登记为一个非密钥 manifest，密钥只放 `.env.local` 或 iCloud 登记表：

```yaml
targets:
  - id: renewal_may_2026_6fDmy0
    enabled: true
    kind: update_existing_records
    webhook_env: WECOM_SMARTSHEET_WEBHOOK_RENEWAL_MAY
    state: state/renewal_2026_may_jul_vin_record_map_6fDmy0.json
    schema: outputs/renewal_may_jul_schema_6fDmy0.json
    default_fields: [is_renewed, is_quoted, pricing_factor]
    observe_fields: [insurance_grade, loss_company]
    key: vehicle_frame_no
    batch_size: 50
```

日常发布只读 manifest：

1. 先 dry-run 汇总每个 target 的 `to_add/to_update/missing/state/schema`。
2. 只有默认字段集允许自动 execute。
3. `observe_fields` 只出报告，不自动写入；需要表端选项补齐后再切入默认字段集。
4. 每个 target 的 state 文件名必须带目标短 key，防止 webhook 转让后误用旧 record_id。
5. 每次 webhook 转让或重建表，必须同时更新：`webhook_env`、`schema`、`state`，三者不可只改一个。
