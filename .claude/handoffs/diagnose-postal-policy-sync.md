# 交接 Prompt — `diagnose-postal-policy-sync` 技能（邮政签单同步）

> **用途**：本文件是写给「新会话 Claude」的自包含交接。新会话从零开始读这一份就能直接接力，无需回看上游对话。

---

## 1. 一句话目标

把 chexian-api 的"经代名含'邮政'、签单日期 ≥ 2026-04-20"的保单数据，**周期化、增量化**地同步到企业微信智能表「**车险业务员保单明细**」，最终封装为 chexian-api 项目内的一个 `diagnose-postal-policy-sync` 技能。

---

## 2. 三步全流程

### Step 1 — 建表（✅ 已完成）

| 字段 | 值 |
|------|-----|
| 智能表名 | 车险业务员保单明细 |
| URL | `https://doc.weixin.qq.com/smartsheet/s3_ABkAfniHALMCNZ1iOnwIsScu1R2Ew_a?scode=ACgAVgdtAA4gLKqo30ABkAfniHALM` |
| docid | `dcJ-zNN0aLOLdF2vV6T-Yabc_iRjeZ0a3ZJQC0l05gyT5Qe5IQ2MIAWKK19GIzgPMjTph6l4pP4EPuNLhdXz3C6g` |
| sheet_id | `q979lj` |

11 个字段已建好，`field_id` 列表（**写记录时按 field_id 引用更稳，避免重名风险**）：

| 用户字段名 | field_id | 字段类型 | 备注 |
|----------|----------|----------|------|
| 业务员 | `fIRILE` | TEXT | |
| 车牌 | `fWbeil` | TEXT | |
| 风险等级 | `f1RB2K` | SINGLE_SELECT | `is_quick_add=true` 自动入选项 |
| 保费 | `fTHxjw` | NUMBER | 默认 0 位小数，**写入前可在 UI 调成 2 位+千分位** |
| 自主系数 | `fMc5sO` | NUMBER | 默认 0 位小数，**写入前需在 UI 调成 3 位小数** |
| 签单日期 | `fK6Njt` | DATE_TIME | 显示 `yyyy年m月d日`，写入用 `YYYY-MM-DD` |
| 起保日期 | `fKXu8z` | DATE_TIME | 同上 |
| 厂牌车型 | `ftlPvj` | TEXT | |
| 年龄分组 | `fm1Pg9` | SINGLE_SELECT | |
| 车架分段 | `f9W7Xr` | SINGLE_SELECT | ⚠️ 语义待确认，见 §4 |
| 车龄分段 | `fkHRFt` | SINGLE_SELECT | ⚠️ 注册表未注册，见 §4 |

### Step 2 — 首次全量导入（⏳ 本次要做的）

筛选条件：

```sql
WHERE agent_name LIKE '%邮政%'
  AND policy_date >= '2026-04-20'   -- 到当前最新签单日
```

数据源：`数据管理/warehouse/policy/current/*.parquet`（已 ETL 的保单事实表）

工具：`wecom-cli doc smartsheet_add_records`（批量写入；分批 200 条以下避免 payload 过大）

### Step 3 — ETL 后增量同步（🔮 框架已就绪，仅需配置）

**好消息**：项目已有 `runPostEtlIntegrations()` 框架（`数据管理/daily.mjs:587`），通过 `WECOM_SMARTSHEET_ENABLED=1` 开关 + YAML instance 驱动，每次 ETL 完成后自动跑同步脚本 `数据管理/integrations/wecom_smartsheet/sync_renewal_v2.py`。

第 3 步**不需要写 webhook 框架**，只需：

1. 新增 instance：`数据管理/integrations/wecom_smartsheet/instances/postal-sign-since-20260420.yaml`
2. YAML 里声明 `docid` + `sheet_id` + `filter`（agent_name + policy_date）+ 字段映射 + 增量主键（建议 `policy_no`）
3. 确认 `sync_renewal_v2.py` 是否支持「按主键 upsert」（如不支持，需扩展或新建 `sync_filtered_policies.py`）

---

## 3. 字段映射结论（已与 chexian-api 字段注册表对齐）

> 来源：`server/src/config/field-registry/fields.json`（42 字段）

| # | 智能表字段 | 注册表字段（en） | 注册表字段（cn 标签） | 行号 | 类型 | 备注 |
|---|----------|-----------------|---------------------|------|------|------|
| 1 | 业务员 | `salesman_name` | 业务员姓名 | L42-48 | VARCHAR | ✅ 直接映射 |
| 2 | 车牌 | `plate_no` | 车牌号码 | L339-345 | VARCHAR | ✅ |
| 3 | 风险等级 | `insurance_grade` | 车险风险等级（A-G/X） | L276-282 | VARCHAR | ✅ 三字段合并 |
| 4 | 保费 | `premium` | 签单保费 | L15-21 | DOUBLE | ✅ 注意是签单口径，正值=承保 |
| 5 | 自主系数 | `commercial_pricing_factor` | 商车自主定价系数 | L204-210 | DOUBLE | ✅ |
| 6 | 签单日期 | `policy_date` | 签单日期 | L24-30 | DATE | ✅ 别名含 `sign_date` |
| 7 | 起保日期 | `insurance_start_date` | 保险起期 | L33-39 | DATE | ✅ |
| 8 | 厂牌车型 | `vehicle_model` | 厂牌车型 | L168-174 | VARCHAR | ✅ 单字段已合并 |
| 9 | 年龄分组 | `driver_age_group` | 被保险人年龄分组 | L357-363 | VARCHAR | ✅ 已是分桶字段 |
| 10 | 车架分段 | `vehicle_frame_no`? | 车架号 VIN（17 位） | L222-228 | VARCHAR | ⚠️ **歧义待确认** |
| 11 | 车龄分段 | （未注册） | — | — | — | ⚠️ **未注册需新增或派生** |

### 待用户确认的歧义点（新会话开干前先问）

- **Q1（#10 车架分段）**：注册表里 `vehicle_frame_no` 是 17 位 VIN 字符串，不是"分段"。你说的"车架分段"是：
  - (a) 按 VIN 前缀/品牌段分桶（如 LSG / WBA / VIN 首 3 位）？
  - (b) 按车价分段（如 5 万以下 / 5-15 万 / 15-30 万 / 30 万以上）？
  - (c) 按车长/车型尺寸分段？
  - (d) 其他口径？

- **Q2（#11 车龄分段）**：注册表无此字段。建议：
  - (a) 在 `fields.json` 新增 `vehicle_age_group` 派生字段（如 0-1年/1-3年/3-5年/5-8年/8+），从 `first_registration_date` 计算。
  - (b) 同步脚本里运行时计算，不入注册表。
  - (a) 更规范（一对一映射，未来其他场景可复用），但要走字段注册 codegen 流程。

请 Step 2 开始前先答这两题。

---

## 4. 第 2 步详细执行步骤（按顺序）

### 4.1 与用户确认 §3 的 Q1 / Q2

**禁止**默认猜测——这是项目铁律"分析前必查不猜"。

### 4.2 编写 SQL 抽数

新建 `server/src/sql/postal-policy-detail.ts`（或 ad-hoc 脚本 `scripts/ad-hoc/postal_policy_export.py`，看是否要走 API 路径或一次性导出）：

```sql
SELECT
  salesman_name,
  plate_no,
  insurance_grade,
  premium,
  commercial_pricing_factor,
  policy_date,
  insurance_start_date,
  vehicle_model,
  driver_age_group,
  vehicle_frame_no,                   -- 或派生 vehicle_frame_segment
  /* 车龄分段：按 Q2 答案决定 */
  CASE
    WHEN DATE_DIFF('year', first_registration_date, policy_date) <= 1 THEN '0-1年'
    WHEN DATE_DIFF('year', first_registration_date, policy_date) <= 3 THEN '1-3年'
    WHEN DATE_DIFF('year', first_registration_date, policy_date) <= 5 THEN '3-5年'
    WHEN DATE_DIFF('year', first_registration_date, policy_date) <= 8 THEN '5-8年'
    ELSE '8年以上'
  END AS vehicle_age_group,
  policy_no                            -- 用作增量同步的主键，不写入智能表
FROM read_parquet('数据管理/warehouse/policy/current/*.parquet', union_by_name=true)
WHERE agent_name LIKE '%邮政%'
  AND policy_date >= '2026-04-20'
ORDER BY policy_date DESC, policy_no
```

**验证口径**：
```bash
duckdb -c "SELECT COUNT(*), MIN(policy_date), MAX(policy_date) \
  FROM read_parquet('数据管理/warehouse/policy/current/*.parquet', union_by_name=true) \
  WHERE agent_name LIKE '%邮政%' AND policy_date >= '2026-04-20'"
```

### 4.3 调用 wecom-cli 批量写入

```bash
wecom-cli doc smartsheet_add_records '{
  "url": "https://doc.weixin.qq.com/smartsheet/s3_ABkAfniHALMCNZ1iOnwIsScu1R2Ew_a",
  "sheet_id": "q979lj",
  "records": [
    {
      "fields": {
        "fIRILE": "张三",                  /* 业务员 */
        "fWbeil": "川A12345",              /* 车牌 */
        "f1RB2K": {"text": "B"},           /* 风险等级 SINGLE_SELECT 用 {text} 自动添加选项 */
        "fTHxjw": 4521.30,                 /* 保费 */
        "fMc5sO": 0.850,                   /* 自主系数 */
        "fK6Njt": "2026-04-25",            /* 签单日期 */
        "fKXu8z": "2026-04-26",            /* 起保日期 */
        "ftlPvj": "大众-朗逸",              /* 厂牌车型 */
        "fm1Pg9": {"text": "30-40岁"},
        "f9W7Xr": {"text": "LFV"},
        "fkHRFt": {"text": "3-5年"}
      }
    }
    /* ... 批量 ≤200 条 ... */
  ]
}'
```

**单元格值格式参考**：`~/.claude/skills/wecomcli-smartsheet/smartsheet-cell-value-formats.md`（SINGLE_SELECT 用 `{text: ...}`、DATE_TIME 用 `YYYY-MM-DD` 字符串、NUMBER 直接传数字）。

### 4.4 验证

- 浏览器打开智能表 URL，肉眼确认 N 条记录已落地、字段无错位。
- wecom-cli `smartsheet_get_records` 取前 5 条对账。
- 与 duckdb 直查的 COUNT/SUM(premium) 对齐。

---

## 5. 第 3 步框架就位的具体动作

### 5.1 新增 instance YAML

新建 `数据管理/integrations/wecom_smartsheet/instances/postal-policy-since-20260420.yaml`：

```yaml
name: postal-policy-since-20260420
description: 邮政经代签单明细（2026-04-20 起）增量同步
target:
  url: https://doc.weixin.qq.com/smartsheet/s3_ABkAfniHALMCNZ1iOnwIsScu1R2Ew_a
  sheet_id: q979lj
filter:
  agent_name_like: "%邮政%"
  policy_date_gte: "2026-04-20"
primary_key: policy_no
field_mapping:
  salesman_name: fIRILE
  plate_no: fWbeil
  insurance_grade: f1RB2K
  premium: fTHxjw
  commercial_pricing_factor: fMc5sO
  policy_date: fK6Njt
  insurance_start_date: fKXu8z
  vehicle_model: ftlPvj
  driver_age_group: fm1Pg9
  # vehicle_frame_segment: f9W7Xr   # 见 Q1 答案
  vehicle_age_group: fkHRFt          # 见 Q2 答案（若入注册表则去派生）
sync_mode: upsert    # 按 primary_key upsert，避免重复
```

### 5.2 同步脚本扩展（如必要）

读 `数据管理/integrations/wecom_smartsheet/sync_renewal_v2.py`，确认：
- 是否支持 `sync_mode: upsert`（按主键去重写）
- 是否支持任意 `filter` 字段（不止 renewal 场景）

如仅支持续保场景，新建 `sync_filtered_policies.py`，复用 `sync_renewal_v2.py` 的 wecom-cli 调用与字段映射封装，重写 SQL 抽数部分。

### 5.3 启用 webhook

```bash
# .env 或 ecosystem.config.cjs 里
WECOM_SMARTSHEET_ENABLED=1

# 验证
node 数据管理/daily.mjs  # ETL 后会自动调 runPostEtlIntegrations()
```

---

## 6. 封装为 `diagnose-postal-policy-sync` 技能

> 用户惯例：`.claude/commands/diagnose-*` 是 chexian-api 命令前缀，本技能沿用。

建议目录结构（与项目内已有 diagnose-* 命令对齐）：

```
.claude/commands/diagnose-postal-policy-sync.md     # 命令入口（短，给用户调用）
.claude/skills/diagnose-postal-policy-sync/         # 技能详细实现（可选，复杂逻辑放这）
  ├─ SKILL.md
  └─ references/
      ├─ field-mapping.md         # §3 表
      ├─ sql.md                   # §4.2 SQL
      └─ instance-template.yaml   # §5.1 模板
```

`.claude/commands/diagnose-postal-policy-sync.md` 内容要点：
- 触发命令：`/diagnose-postal-policy-sync`
- 子命令：`init`（首次全量）/ `sync`（增量）/ `verify`（对账）
- 调用约定：默认读 `instances/postal-policy-since-20260420.yaml`，可 `--instance <name>` 覆盖

---

## 7. 关键路径速查

| 用途 | 路径 |
|------|------|
| 字段注册表（唯一事实源） | `server/src/config/field-registry/fields.json` |
| 字段 codegen | `scripts/field-registry/generate.mjs` |
| ETL 入口 | `数据管理/daily.mjs`，`runPostEtlIntegrations()` @ L587 |
| 同步脚本 v2 | `数据管理/integrations/wecom_smartsheet/sync_renewal_v2.py` |
| Instance 目录 | `数据管理/integrations/wecom_smartsheet/instances/` |
| 数据源 Parquet | `数据管理/warehouse/policy/current/*.parquet` |
| wecom-cli 字段类型 | `~/.claude/skills/wecomcli-smartsheet/smartsheet-field-types.md` |
| wecom-cli 单元格值 | `~/.claude/skills/wecomcli-smartsheet/smartsheet-cell-value-formats.md` |
| 业务规则字典 | `数据管理/knowledge/rules/车险数据业务规则字典.md` |

---

## 8. 风险与防呆清单

| 风险 | 防呆 |
|------|------|
| `vehicle_frame_no` 写入 VIN 全串 vs 用户期望"分段" | §3 Q1 必须先确认 |
| 自主系数 0 位小数显示成 1 | 写入前在 UI 调成 3 位小数（或先调列再首次导入） |
| 重复写入造成数据冗余 | Step 3 走 `sync_mode: upsert`，按 `policy_no` 去重 |
| 智能表 SINGLE_SELECT 选项膨胀（is_quick_add=true 副作用） | 写入前在 UI 预设 A-G/X 等枚举（风险等级、年龄分组） |
| `policy_no` 年度唯一（业务规则字典） | 跨年同步要 `(policy_no, EXTRACT(YEAR FROM policy_date))` 复合主键 |
| ETL 失败时 webhook 仍触发脏数据 | 在 `runPostEtlIntegrations()` 前置成功检查（看 daily.mjs:920 附近 errcode） |
| wecom-cli 授权过期重现 | 把 850001 / 851008 / 851014 写进技能 SKILL.md 的"troubleshooting"节 |

---

## 9. 新会话 Claude 的第一动作清单

复制粘贴这段做开场：

```
我接力执行 chexian-api 的 diagnose-postal-policy-sync 技能。已读 .claude/handoffs/diagnose-postal-policy-sync.md。

Step 1 建表已完成，现在做 Step 2 首次导入。开始前我需要用户确认两个歧义字段：

Q1（车架分段）：你说的"车架分段"是 VIN 前缀分桶 / 车价分桶 / 车长分桶 / 其他口径？注册表里的 vehicle_frame_no 是 17 位 VIN 全串，跟"分段"语义不符。

Q2（车龄分段）：注册表里没这个字段。你倾向 (a) 新增 vehicle_age_group 到 fields.json 走 codegen，还是 (b) 同步脚本里运行时按 first_registration_date 计算？

请答完这两题，我接着抽数→批量写入→对账。
```

---

**版本**：v1 · 2026-05-15 · 由建表会话生成
