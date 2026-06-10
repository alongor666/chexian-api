# Feedback: 复盘的产出必须是机制,不是聊天文本(2026-06-10 Phase 2 收官复盘沉淀)

> 来源:ApiClient 神类拆分 536→558 全线复盘。AI 会话上下文会蒸发——没固化进仓库可执行护栏(governance/hooks/rules/backlog/memory)的教训,会话结束即不存在。本文件承接该复盘中"纯行为纪律类"教训(可代码化的已落 `api-wire-conservation.mjs` 演进通道)。

## 1. 给 sub-agent 的 brief 里的示例代码也是代码(最高价值教训)

PR #556 事故:主会话在任务书里**亲手写了 JWT 字面量**让 agent 做密钥扫描器的正向测试夹具 → agent 忠实照抄提交 → GitGuardian 按 JWT 形状判泄漏 → CI 红 + force-push 抹历史 + 评审 blocker。

**规则**:写 brief 时,夹具/示例/占位值要过与正式代码同一套红线审查。涉密形状的夹具一律用「明显假 + 非真实结构」占位(如 `EXAMPLE-FAKE-TOKEN-not-a-real-secret-0000`),并核对值域约束(该次正则值域 `[A-Za-z0-9._\-]` 不含下划线——用 `_` 分隔的假 token 会让正向用例静默变红)。

## 2. exit code 不进管道

`if git push | tail -2; then` 拿到的是 `tail` 的退出码——被拒的 push 打出假 "PUSH OK"。**要分支判断的命令绝不接管道**;需要裁剪输出时先 `> /tmp/x.log 2>&1` 再按真实退出码分支。

## 3. force-push 即广播

#556 force-push 修复后 1 分钟,评审者基于旧 head 发了完整评审(白跑一轮 worktree 独立验证)。**force-push 后立刻在 PR 留一行**「head 已更新至 <sha>,<原因>」,省评审者整轮重验。

## 4. "机制已在、执行缺位"类教训,不要再写文档规则

同次复盘里的「主目录违纪开发」「#552 重复劳动(未提交前查重)」——规则早已在 `.claude/rules/worktree-setup.md` 与 CLAUDE.md Pre-flight 里,失败模式是**没执行**。对这类教训,再添一条文档规则无增益(本项目原则:文档规则 ≠ 执行规则);正确动作是二选一:升级为自动拦截(hook/governance),或承认属注意力纪律、在会话开工 checklist 里前置执行(开工第一步 = 建 worktree + fetch + 搜同名 PR)。

## 5. 已知知识要在动笔前调用,检查只是兜底

守恒脚本第一版漏扫 `client-core.ts`(明知 REFRESH 已下沉至此,读过该文件三遍),靠自己写的 LOST 检查才咬出来。护栏抓住自己不是骄傲——**写代码那一刻就该把上下文里已有的事实清单过一遍**,门禁是最后一道,不是第一道。
