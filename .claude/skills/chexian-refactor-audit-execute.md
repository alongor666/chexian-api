---
name: chexian-refactor-audit-execute
description: 设计并执行"神类拆分/大迁移"的完备性审计 —— 证明（而非声称）所有消费方/测试/治理门禁/文档/架构不变量都已适配且无遗漏。脊柱是"对拆分前基线做特征化/金 master 行为 diff"，配守恒恒等式 + 持久护栏 + 门禁迁移连续性。Use when 神类拆分后要证明无遗漏、大迁移完备性审计、重构适配审计、prove a refactor is complete，或触发"验证拆分是否漏迁 / 迁移完备性 / golden master diff / 拆完怎么防回退"。注意：本 skill **做**审计；评审别人的"审计计划"用 chexian-refactor-audit-review。
version: 1.0.0
---

# 执行：神类拆分/大迁移完备性审计（Refactor-Completeness Audit）

> 来源：2026-06 ApiClient 神类拆分（1250 行 → `client-core` + `client.ts` + 10 个 `*-api.ts`）适配审计。沉淀"如何**证明**一次大重构无遗漏"。
>
> 语义独立性：通用方法（应过 `rule-promotion-gate`），可上提共享仓；§7、§8 是本项目落地。
>
> 配套评审 skill：[chexian-refactor-audit-review](./chexian-refactor-audit-review.md)（你的产物会被它对抗性打分，照其标准自检）。

## 0. 立场与铁律

| 铁律 | 含义 |
|------|------|
| **证明，不声称** | 每个结论 = `PASS/FAIL/N-A + 可复现证据`。无证据的"应该没问题"= FAIL。 |
| **基线 diff 是脊柱** | 重构正确性的唯一可靠证明 = **拆分前行为 vs 拆分后行为的 diff**（§1）。其余维度是补充，不是替代。 |
| **修补不拆除** | 发现漏项就补，不推倒重来。 |
| **守恒可计算** | "没漏迁"要能算出来（§3），不靠人眼扫。 |
| **护栏是目的** | 拆分的价值=可维护性持久。没有防回归护栏的拆分，半年后退回神类（§5）。 |

## 1. 脊柱 — 特征化 / 金 master 基线 diff

这是 Michael Feathers《Working Effectively with Legacy Code》的**特征化测试（characterization test，又名 approval / snapshot / golden master）**：先锁住"代码现在实际做什么"，再重构，diff 出意外偏差。

对"API 客户端/接口层"拆分，**捕获每个公开方法实际发出的请求**，对拆分前后做 diff：

```
# 对 pre-split commit 与 HEAD 各跑一遍：spy 掉 fetch/transport，
# 对每个公开方法用固定入参调用，记录 { method, url, headers(尤其 Authorization), body, dedupeKey }
# 然后 diff 两份快照。零 diff = 行为等价；有 diff = 要么 bug 要么需在金 master 里"approve"的有意变更。
```

要点：
- **捕获完整形状**，不止 path：URL（含 query 编码）+ HTTP 动词 + 请求体 + **鉴权头** + 缓存/去重 key。这些正是 tsc 与"只断 path 的契约"测不到的（见 review skill §2 盲区表）。
- **针对拆分前 commit 取基线**（`git worktree add` 或 `git show`），不是针对你刚写的新代码——否则陷入"搬错了但自洽绿"的圈套。
- 这套与契约测试**目标不同**：金 master = 证过去（搬运无误）；契约 = 防未来（漂移）。两者都要（见 review skill §4）。

## 2.（若同时在做拆分）Parallel Change 纪律

Fowler 的 **Parallel Change / expand-contract**：三阶段安全改不兼容接口——
1. **expand**：先加新形态（新 core / 新子客户端），旧形态保留。
2. **migrate**：调用点逐个迁到新形态（可分多 PR，逐域）。
3. **contract**：全部迁完才删旧形态。

风险：卡在 migrate 期要**双形态并存**；不完成 contract 比不动还糟。审计要确认 contract 阶段**真的完成**（旧形态零残留——这正是 §3-A 的工作）。

## 3. 审计维度 MECE 清单（每维配"对的工具"）

逐维输出 `PASS/FAIL/N-A + 证据`：

| 维 | 检查 | 对的工具（不要用错刀） |
|----|------|----------------------|
| **A 残留调用** | 旧形态调用点清零 | `bun run build`（TS 可达） **+** grep tsc 盲区：测试 mock、bracket 访问 `apiClient['x']`、字符串动态调用 |
| **B 守恒恒等式** | 没漏迁/丢方法 | 脚本算 `count(原公开方法) − count(保留) == Σ count(各子模块)`；对不上即 FAIL |
| **C 契约覆盖** | 每个公开方法有契约用例 | **meta 测试**枚举公开方法 ∩ 契约用例，零裸方法；别靠人工数 |
| **D 横切传输核心** | 401 刷新/GET 合并/超时/取消 有专测 | 对 `client-core` 写独立单测（这是全员共享、风险最高、却最易零测的代码） |
| **E 门禁迁移连续性** | 按路径锚旧文件的门禁已重指新文件集 | grep 所有 `scripts/`·`.github/`·hooks 里的旧路径锚点；逐个评估是否扩到新文件（**掏空陷阱**，§8） |
| **F 持久护栏** | 防回归机制存在且是**验收闸** | import-boundary 测试/lint：子模块禁 import 写方法、禁 new 第二个 core；方法禁回流神类 |
| **G 文档/索引** | 索引·必读文档·规则·agent/skill 影响半径含新文件；同名异物区分 | grep 索引 + 旧结构描述；区分同名异物（如 `api/client.ts` vs `duckdb/client.ts`） |
| **H 运行时实证** | build/全量单测/E2E/健康/端点 diff 本轮真跑 | 真跑并贴输出；区分"CI 无数据的绿"与"数据路径绿" |

## 4. 守恒恒等式（B 维展开）

```
原神类公开方法数  N_origin   （git show <split前>~1:<file> 数公开方法）
保留在基类的方法数 N_retain   （人工列举 + 留置判据）
分散到各子模块方法 N_distrib  （Σ 各 *-api.ts 公开方法）
契约用例数        N_contract

断言： N_origin == N_retain + N_distrib
断言： N_contract >= N_retain + N_distrib   （每方法至少一例）
```

对不上=有方法在搬运中蒸发（连同调用点被同 PR 删掉，tsc 与契约都不会报）。这是定性"为何保留"判断给不了的**定量兜底**。

## 5. 持久护栏（F 维展开 —— 拆分的目的）

拆完最容易半年后退回原样。必须留**机器可执行**的护栏，且作**验收闸**（不是"评估缺口"的可选项）：

- **写权限隔离**：子模块只能拿只读传输句柄；测试断言任何 `*-api.ts` 不 import `setToken/clearToken`。
  - ⚠️ 同时查：具体类/单例是否仍 `public` 暴露写方法且被外部调用——"只读"可能只对子模块成立，单例面仍是写开放（本项目 `apiClient.setToken/clearToken` 仍被 3 个 context 调用，是**有意保留**但要在不变量里**说清边界**，别声称"全只读"）。
- **单实例**：grep 仅一处 `new XxxCore`；测试/lint 防第二个 core。
- **门禁随结构走**：见 §8，把契约联动门禁扩到新文件集，否则护栏当天就空转。

## 6. 反模式

- ❌ 照新代码写契约就宣称"迁移正确"（自洽陷阱；缺金 master）。
- ❌ tsc 绿=完成（漏 mock/bracket/字符串/丢方法）。
- ❌ 只同步文档、不补门禁与护栏（文档是最低 severity）。
- ❌ 横切核心（刷新/合并/超时）不写测试就放行。
- ❌ 留"评估缺口"而不落地护栏（拆分价值随即蒸发）。

## 7. 本项目验证命令

```bash
bun run build                  # A/H：TS 可达残留 + 零类型报错
bun run test                   # C/H：契约 + 单测全绿
bun run governance             # E：治理门禁（含热点契约联动）
git show <split前commit>~1:src/shared/api/client.ts | wc -l   # B：原始规模/方法数
# 金 master：spy fetch，对 pre-split 与 HEAD 各跑公开方法，diff URL+动词+头+体
# E2E：bun run test:e2e（需先 dev:full）
curl -s localhost:3000/api/query/kpi | jq '.data|length'      # H：端点实证
```

## 8. 掏空陷阱（E 维，必查）

`scripts/check-hotfile-contracts.mjs` 按**精确路径** `src/shared/api/client.ts` 锚定→要求改 `client-contracts.test.ts`。神类拆分把业务方法搬到 `*-api.ts` 后，**改子客户端不触发该门禁**，契约联动只剩守 ~15 个保留方法。**审计必须**：把 `*-api.ts`（10 个）与 `client-core.ts` 纳入门禁锚点，否则护栏在拆分完成当天即空转。凡"按路径锚旧文件"的脚本（governance/hooks/CI）都套此检查。

## 9. 产出 & 总闸 & DoD

- **产出**：§3 每维 `PASS/FAIL/N-A + 证据`；守恒恒等式计算结果；金 master diff 结果；新发现漏项（阻塞/非阻塞）。
- **总闸（可证伪）**：审计通过 ⟺ `A 残留=0 ∧ B 恒等式成立 ∧ D 横切有测试 ∧ E 门禁已重指 ∧ F ≥1 护栏已合并 ∧ H 本轮全绿`。
- **DoD**：
  - [ ] 金 master 基线 diff 已跑（对拆分前 commit），偏差为 0 或已 approve。
  - [ ] 守恒恒等式成立。
  - [ ] 横切核心有独立测试。
  - [ ] 门禁锚点已扩到新文件集（掏空陷阱关闭）。
  - [ ] ≥1 条持久护栏已落地为验收闸。
  - [ ] build/test/governance/E2E/健康 本轮真跑且贴出证据。
