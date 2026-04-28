# 维修合作网络质量评估设计

## 1. 背景

- 当前项目已具备 `RepairDim` 与 `ClaimsDetail` 两个可直接联动的数据域，能够支持送修资源网络质量评估。
- `RepairDim` 提供维修厂合作状态、4S 标记、地理归属、核损金额、签单净保费等资源侧信息。
- `ClaimsDetail` 提供标的送修网点、事故区县、赔案数量、车物赔款等承接侧信息。
- 现有页面与 SQL 已覆盖部分维修资源分析能力，但还缺少一套以“合作网络质量”为中心、可核验 shadow 与流程占位噪音的源数据验证底表。

## 2. 目标

- 形成一套正式、可复用的“维修合作网络质量评估”分析框架。
- 将分析重点聚焦于四个高价值维度：
  - 修保比
  - 本地资源占比
  - 4S 对比
  - 网点稳定度
- 提供一份可执行的 P0 验证脚本，直接从 Parquet 读取并输出核心底表，先验证主题价值与数据噪音边界，再决定是否页面化。

## 3. 不做什么

- 不在本次工作中直接开发前端页面或新增 API 路由。
- 不扩展到业务员层、客户类别层等更深经营分析。
- 不把 `RepairDim.net_premium` 直接用于绝对经营判断；首版仅用于相对排序和异常提示。

## 4. 核心分析问题

### 4.1 网络是否稳定

- 当前有效网点中，真正处于可用状态的占比是多少。
- 风险网点是否主要集中在高价值网点。
- 有效维修网点池外承接是否严重，且其中多少是真正未登记 shadow、多少是流程占位/伪网点。

### 4.2 网络是否有效

- 合作网点是否真正承接了与其保费贡献相匹配的维修产值。
- 是否存在高保费低修保比网点，说明合作深度不足。

### 4.3 网络是否贴近事故空间

- 事故是否更多被导向本地区县内的合作网点。
- 哪些区县存在“有网点但本地承接差”或“靠网点池外承接”的问题。

### 4.4 网络结构是否合理

- 4S 与非 4S 在活跃度、修保比、本地承接表现上谁更优。
- 是否存在结构过重、覆盖不足或承接效率不均的问题。

## 5. 数据范围与口径

### 5.1 数据域

- 主域：`RepairDim`
- 主域：`ClaimsDetail`
- 辅助域：`PolicyFact`（本次验证阶段默认不强依赖）

### 5.2 时间口径

- `rolling12`：以 `ClaimsDetail.accident_time` 最大日期为锚点，向前滚动 12 个月。
- `ytd`：以 `ClaimsDetail.accident_time` 最大日期所在年份作为当前分析年。
- `all`：全量，仅用于辅助核对。

### 5.3 网点池定义

- `repair_all`：`RepairDim` 全量登记网点，仅用于判断赔案网点是否真正未登记。
- `repair_base`：从 `repair_all` 剔除非维修/流程占位后的有效维修网点池，用于活跃率、修保比、本地承接。
- `process_excluded_shops`：在 `RepairDim` 已登记，或在 `ClaimsDetail.subject_repair_shop` 名称侧命中“定损/自选/无/无车损/外观定损/现场定损”等规则的流程占位或伪网点。
- `unregistered_shadow`：`ClaimsDetail` 中出现但不在 `repair_all`，且名称侧未命中流程占位规则的真实未登记影子网点。

### 5.4 核心派生口径

- `shop_code`：`COALESCE(shop_code, SUBSTR(shop_name, 1, 8))`。
- `coop_tier`
  - `active`：`1生效中`
  - `past`：`0暂停合作` / `7已撤销` / `8失效`
  - `none`：`3退回修改` / `5待复核` / `无合作` / `NULL`
- `repair_to_premium_ratio`：`SUM(damage_assessment_amount) / NULLIF(SUM(net_premium), 0)`，仅做相对排序和异常识别。
- `local_resource_ratio`：`本地事故本地承接赔案数 / 承接总赔案数`；`ClaimsDetail.accident_district` 必须先去除行政编码前缀，再与 `RepairDim.district` 比较。
- `vehicle_settled_amount`：维修承接金额使用 `ClaimsDetail.settled_vehicle_amount`；`settled_amount` 只作为核对列。

### 5.5 聚合安全规则

- 资源侧金额必须先在 `repair_base` 内独立聚合。
- 赔案侧数量、本地承接、shadow 分类必须先在 `claims_scope` 或 JOIN 后独立聚合。
- 禁止在 `repair_base LEFT JOIN claims_scope` 后直接 `SUM(repair_base.net_premium)` 或 `SUM(repair_base.damage_assessment_amount)`，避免按赔案行数放大资源金额。

## 6. 分析框架

### 6.1 模块一：网络总览

- 目标：快速回答网络是否整体健康，以及有效网点池外承接的噪音结构。
- 关键指标：
  - `registered_shop_count`
  - `effective_shop_count`
  - `process_excluded_shop_count`
  - `active_rate`
  - `unregistered_shadow_claim_share`
  - `excluded_process_claim_share`
  - `repair_to_premium_ratio`
  - `local_resource_ratio`

### 6.2 模块二：修保比

- 目标：判断维修产值与经营贡献是否匹配。
- 关键指标：
  - `damage_assessment_amount`
  - `net_premium`
  - `repair_to_premium_ratio`
- 重点识别：
  - 高保费低修保比网点
  - 高修保比低保费网点
  - 非 active 但高价值网点

### 6.3 模块三：本地资源占比

- 目标：判断网络布局是否贴近事故发生空间。
- 关键指标：
  - `total_claims`
  - `local_claims`
  - `local_resource_ratio`
  - `raw_local_resource_ratio`
- 重点识别：
  - 高赔案低本地承接区县
  - 有资源但承接差的区县
  - raw 比较为 0 但归一化后恢复的区县口径问题

### 6.4 模块四：4S 对比

- 目标：判断 4S 与非 4S 结构是否合理。
- 关键指标：
  - `shop_count`
  - `active_rate`
  - `repair_to_premium_ratio`
  - `local_resource_ratio`
  - `avg_net_premium_per_shop`
  - `avg_damage_amount_per_shop`
- 重点识别：
  - 4S 主导但本地承接弱
  - 非 4S 承接更强
  - 结构失衡的机构

### 6.5 模块五：网点稳定度

- 目标：识别高价值但不稳定的网点、未登记 shadow 与流程占位/伪网点风险。
- 关键指标：
  - `coop_tier`
  - `claim_count`
  - `vehicle_settled_amount`
  - `damage_assessment_amount`
  - `net_premium`
- 重点识别：
  - 高价值非 active 网点
  - 高赔案未登记影子网点
  - 高赔案流程占位/伪网点

## 7. 首版交付形式

- 文档：正式分析框架。
- 脚本：Parquet 直读 P0 验证脚本。
- 输出：
  - 整体指标与回归断言。
  - 机构质量排名。
  - 4S 对比底表。
  - 高风险网点清单。
  - 低本地承接区县清单。
  - 未登记影子网点清单。
  - 流程占位/伪网点清单。

## 8. 成功标准

- 能从真实 Parquet 中直接输出上述 P0 指标。
- 资源侧金额聚合不被赔案 JOIN 放大。
- 能拆清“未登记 shadow”与“流程占位/伪网点”，不再把有效网点池外承接全部解释为未登记外流。
- 结论能明确指向至少三类治理动作：
  - 恢复合作
  - shadow 转登记或补网
  - 流程占位/伪网点清洗
  - 区县补网

## 9. 风险与限制

- `channel_type` 缺失较多，不纳入首版主结论。
- `subject_repair_shop` 在 2025+ 更完整，因此结论应优先使用 `rolling12` 或 YTD。
- 当前“稳定度”更适合解释为“状态稳定度/合作风险度”，不直接代表长期历史稳定关系。
- `RepairDim.net_premium` 的业务含义仍需确认，首版不直接做绝对经营判断。
- `ClaimsDetail.accident_district` 当前含行政编码前缀，而 `RepairDim.district` 为纯区县名；计算本地资源占比时必须先做区县名归一化，否则结果会系统性偏低。
