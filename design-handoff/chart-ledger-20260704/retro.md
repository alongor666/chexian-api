# 复盘 — 图表账本（/chart-ledger） 2026-07-04

> Phase D 复盘。落地 PR：#891（视觉重做）→ #892（凭据闸随行加固）→ #894（12 卡读图指南 infograph 二期）。三个 PR 均 CI 全绿合并、review 意见为零（无 5 步 SOP 处置项）。模板源：ui-redesign skill references/evolution.md。

## 结果
- 备料→Claude Design→落地 整体顺畅度：**4/5**（备料与落地顺畅；取稿环节被 DesignSync 交互式授权卡住，改走用户浏览器登录态取回，多花一轮）
- Claude Design 出稿可用度：**4/5，1 轮收敛**（方向 A 直接采纳；结构/信息层级/左右栏叙事可直接落地，数据与维度需按真实契约重建）

## Claude Design 哪里没达预期
- **把 current-page.html 的样例数字写死进设计稿，并把 02/03/09/12 四张卡的维度临时替换成客户类别做 demo**（真实维度是三级机构等，见 ledgerMeta.ts）
  - 归因：☑ 简报没写清（未声明"数值=占位、维度=数据契约不可替换"）＋ ☑ 模型默认行为（把上传稿当排版素材自由改写）
  - 下次改进：已回写 skill——简报模板红线加"禁替换维度字段"条款、context-spec §4 加"current-page.html 是排版素材不是数据契约"叮嘱（commit e7f0f78）
- 导出 HTML 第 4 行混入查看器注入脚本（`data-omelette-injected`），非设计内容，落地前剥离
  - 归因：产品导出机制，非简报问题
  - 下次改进：已回写 SKILL.md Phase B 取稿后备路径备注

## 发现阶段问题
- 无重大遗漏：交互清单（锚点导航/scrollspy/加载三态/重试/空态）在落地稿中逐项保留并增强；字段契约表未漏字段。
- 取稿路径盲区：DesignSync/MCP 需交互式 `/design-login`，非交互会话不可用 → 后备 = 经用户已登录浏览器调 claude.ai/design 内部接口取回文件内容。→ 已回写 SKILL.md Phase B。

## 落地阶段问题（4 条均已回写 skill acceptance-criteria §5 陷阱清单）
1. `dark:bg-surface-1/85` **静默不生效**——`surface-*` 是 CSS 变量色、tokens 无 `<alpha-value>` 占位，Tailwind `/NN` 透明度修饰生成不出类 → 改不透明 `dark:bg-surface-1` 并加注释。
2. 裸 `href="#stage-1"` 页内锚点被 hash 路由当路由切换致**黑屏**（旧版潜伏 bug，本次顺带修复）→ `preventDefault` + `scrollIntoView`。
3. 24 列发展三角把 grid 轨道撑爆挤扁左栏（子项默认 `min-width:auto`）→ 两栏加 `min-w-0`，内层 `overflow-x-auto` 接管滚动。
4. 浏览器跨 dev-server 重启复用**旧模块缓存**（DOM 呈旧类名、curl 源码已新），险些误判回归 → 硬刷新后复核，以 curl 源码为准。

## 分流结论
- 通用经验 → 已回写 ui-redesign skill 仓库（`~/alongor666-skills`，commit `e7f0f78`，v2.3.0）：
  - `references/design-brief-template.md`：红线加"禁替换维度字段（数值=占位、维度=契约）"
  - `references/claude-design-context-spec.md`：§4 加"current-page.html 是排版素材不是数据契约"
  - `references/acceptance-criteria.md`：§5 加 4 条静默失效型落地陷阱自查
  - `SKILL.md`：Phase B 加取稿后备路径（含剥离注入脚本）；version 2.2.1→2.3.0
- 项目专属经验（记本文件夹，不污染通用 skill）：
  - 12 卡维度契约唯一事实源 = `src/features/chart-ledger/ledgerMeta.ts`，设计稿维度以此为准；
  - infograph 二期设计规格见 `../chart-ledger-infograph-20260704/design-spec.md`（读图指南=方法论层，零查询、阈值引 `LOSS_RATIO_THRESHOLD`）；
  - 弹层关闭禁挂 document 全局 mousedown（PR #481 教训），背板用 button 自身 onClick + ESC + ×。

## 本次备料阶段已知的待验证假设（落地时核）——核销
1. ~~current-page.html 用样例数据还原——若 Claude Design 对"数字当占位"理解偏差（把样例数字写死进设计），落地时须以真实查询为准；~~ **命中**：样例数字被写死、4 卡维度被换 demo。落地按真实契约重建，未照抄。→ 已回写简报模板 + context-spec。
2. ~~简报允许它把 11px/13px/15px 归档到 12/14/16——若归档导致密度损失，落地可保留原微调值（历史遗留非红线）；~~ **无损失**：落地保留原微调字号（10/11/13/15px 共 21 处），密度未受影响。无需回写。
3. ~~简报开放了"漏斗渐变条可改纯色"——若它全页禁渐变连数据编码也砍了，属简报措辞问题，记入归因。~~ **未发生**：漏斗改 teal 透明度色带，层级编码保留；全页唯一渐变是骨架屏 shimmer（加载动画，允许）。措辞无问题。
