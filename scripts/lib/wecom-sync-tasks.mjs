/**
 * 企微智能表格同步任务 SSOT（2026-07-22 自 sync-and-reload.mjs Stage 5 抽出）
 *
 * 背景（PR #1158 评审 F1/F2）：企微编排移到早批后，若沿用「Stage 5 任一企微任务失败 →
 * 抛错 → 进程非零退出」旧行为，watcher 会把早批整体标 failed：晚批 fail-closed 拒发
 * （报价/维修/厂牌/续保追踪核心数据全被连坐）+ 早批 ETL/reload 整链重跑。
 * 基线（企微在晚批尾部）不存在这条下游阻断链，移批后必须显式拆分两种状态：
 *   - 核心数据发布状态（ETL/VPS/reload/health）——决定批次 released/failed；
 *   - 企微同步状态——失败**永不阻断**发布，只独立告警 + 独立重试。
 *
 * 本文件把三件事定为可单测锁定的纯函数（F2 回归测试见 tests/wecom-sync-tasks.test.ts）：
 *   1. 任务清单构建（buildWecomTasks）——5 张表的脚本/参数/超时/停推日；
 *   2. 到期停推（filterActiveWecomTasks）——5-7 月续保 2 表北京 2026-07-31（含）后自动退役；
 *   3. 失败策略（evaluateWecomOutcome）——releaseBlocking 恒 false（策略 SSOT，单测锁定）。
 *
 * 无副作用、不读文件系统 / env / 时钟，可被 vitest 直接 import（与 release-batches.mjs 同纪律）。
 * 消费方：scripts/sync-and-reload.mjs（发布链 Stage 5）、scripts/wecom-sync.mjs（独立重试入口）。
 */

/**
 * 5-7 月续保追踪企微表停推日（北京时区，含当日）：2026-08-01 起 5-7 月应续保单全部到期，
 * 追踪表（机构续保 + 电销5-7月续保）无意义，故 2026-07-31 为最后一次推送，之后由
 * filterActiveWecomTasks 自动剔除（不删表、不写入、不报错）。签单类 3 表无停推日。
 */
export const MAY_JUL_RENEWAL_WECOM_LAST_DAY = '2026-07-31';

/**
 * 企微失败告警标记文件（相对仓库根；数据管理/logs/ 整体 gitignored，与 watcher 运行时状态
 * auto-release-state.json 同家）。写入方 = sync-and-reload Stage 5 / wecom-sync.mjs
 * （成功清空、失败写入当天失败清单）；消费方 = auto-release-daily watcher（发布成功后读它，
 * 若当天有企微失败则**独立**告警，不影响批次 released 状态）。
 */
export const WECOM_ALERT_MARKER_RELPATH = '数据管理/logs/wecom-sync-alert.json';

/**
 * 构建 5 张企微智能表格同步任务（顺序即并行启动序，无依赖关系）。
 * @param {{dryRun?: boolean, org?: string|null}} opts
 *   dryRun：只打印计划不写入（python 侧 --dry-run / 省略 --execute）；
 *   org：机构续保表限定机构列表（如 '新都,资阳'），仅作用于机构续保任务。
 * @returns {{label:string, args:string[], timeoutMs:number, retireAfterBeijingDay?:string}[]}
 */
export function buildWecomTasks({ dryRun = false, org = null } = {}) {
  const orgRenewalArgs = ['数据管理/integrations/wecom_smartsheet/sync_org_renewal_from_xlsx.py'];
  if (!dryRun) orgRenewalArgs.push('--execute');
  if (org) orgRenewalArgs.push('--org', org);

  // 电销 5-7 月续保表是四川实例：--province 为脚本侧 fail-closed 必填参数（50d62e 省份轴收窄），
  // 此处是调用方对该实例省份的显式声明（同 sync_filtered_policies 用 instance yaml 声明省份）
  const renewalMayArgs = [
    '数据管理/integrations/wecom_smartsheet/sync_may_renewal_fields.py',
    'sync',
    '--province', 'SC',
  ];
  if (!dryRun) renewalMayArgs.push('--execute');

  const postalArgs = [
    '数据管理/integrations/wecom_smartsheet/sync_filtered_policies.py',
    '--instance',
    '数据管理/integrations/wecom_smartsheet/instances/postal-policy-since-20260420.yaml',
    '--mode',
    'sync',
  ];
  if (dryRun) postalArgs.push('--dry-run');

  // 山西邮政/邮储经代签单全量表（branch_code='SX' AND agent_name LIKE '%邮政%'）。
  // 与四川邮政表同引擎、独立 webhook + 独立 state；增量 add-only，防重复防遗漏。
  const shanxiPostalArgs = [
    '数据管理/integrations/wecom_smartsheet/sync_filtered_policies.py',
    '--instance',
    '数据管理/integrations/wecom_smartsheet/instances/shanxi-postal-all.yaml',
    '--mode',
    'sync',
  ];
  if (dryRun) shanxiPostalArgs.push('--dry-run');

  // 太原二部任卫军「业务台账」（branch_code='SX' AND salesman_name='118046126任卫军'，
  // 2025-08-01 起）。同引擎、独立 webhook + 独立 state；首量 888 条已于 2026-07-17
  // 人工导入（--i-checked-wecom-rows），此处仅日常增量 add-only。
  const ty2RenweijunArgs = [
    '数据管理/integrations/wecom_smartsheet/sync_filtered_policies.py',
    '--instance',
    '数据管理/integrations/wecom_smartsheet/instances/shanxi-taiyuan2-renweijun.yaml',
    '--mode',
    'sync',
  ];
  if (dryRun) ty2RenweijunArgs.push('--dry-run');

  return [
    {
      label: dryRun ? 'WeCom renewal dry-run' : 'WeCom renewal sync',
      args: orgRenewalArgs,
      timeoutMs: 90 * 60 * 1000,
      retireAfterBeijingDay: MAY_JUL_RENEWAL_WECOM_LAST_DAY,
    },
    {
      label: dryRun ? 'WeCom 电销5-7月续保 dry-run' : 'WeCom 电销5-7月续保 sync',
      args: renewalMayArgs,
      timeoutMs: 30 * 60 * 1000,
      retireAfterBeijingDay: MAY_JUL_RENEWAL_WECOM_LAST_DAY,
    },
    {
      label: dryRun ? 'WeCom postal dry-run' : 'WeCom postal sync',
      args: postalArgs,
      timeoutMs: 30 * 60 * 1000,
    },
    {
      label: dryRun ? 'WeCom 山西邮政 dry-run' : 'WeCom 山西邮政 sync',
      args: shanxiPostalArgs,
      timeoutMs: 30 * 60 * 1000,
    },
    {
      label: dryRun ? 'WeCom 任卫军台账 dry-run' : 'WeCom 任卫军台账 sync',
      args: ty2RenweijunArgs,
      timeoutMs: 30 * 60 * 1000,
    },
  ];
}

/**
 * 到期停推闸：剔除已过 retireAfterBeijingDay 的任务（北京今天 > 停推日，字典序比较）。
 * todayBeijing 为 null/undefined（beijingDayOf 解析失败）时保守放行全部任务——宁可多推一次
 * 已到期表，不可因时间解析异常静默漏推有效表。
 * @param {ReturnType<typeof buildWecomTasks>} tasks
 * @param {string|null} todayBeijing YYYY-MM-DD（调用方用 beijingDayOf(new Date()) 求得）
 * @returns {{active: typeof tasks, retired: typeof tasks}}
 */
export function filterActiveWecomTasks(tasks, todayBeijing) {
  const active = [];
  const retired = [];
  for (const task of tasks) {
    if (task.retireAfterBeijingDay && todayBeijing && todayBeijing > task.retireAfterBeijingDay) {
      retired.push(task);
    } else {
      active.push(task);
    }
  }
  return { active, retired };
}

/**
 * 从 Promise.allSettled 结果提取失败清单（与 activeTasks 按索引对齐）。
 * @param {PromiseSettledResult<unknown>[]} settledResults
 * @param {ReturnType<typeof buildWecomTasks>} activeTasks
 * @returns {{label:string, reason:string}[]}
 */
export function summarizeWecomFailures(settledResults, activeTasks) {
  return settledResults
    .map((r, i) => ({ r, label: activeTasks[i]?.label ?? `wecom-task#${i}` }))
    .filter(({ r }) => r.status === 'rejected')
    .map(({ r, label }) => ({
      label,
      reason: (r.status === 'rejected' && (r.reason?.message || String(r.reason))) || 'unknown',
    }));
}

/**
 * 🔴 企微失败策略 SSOT（PR #1158 评审 F1）：releaseBlocking **恒为 false**——
 * 企微 webhook / 凭据 / 单表异常只影响企微本身：独立告警（alertNeeded → 标记文件 + watcher
 * 通知）+ 独立重试（scripts/wecom-sync.mjs），**不得**让核心数据发布进程非零退出
 * （否则 watcher 标批次 failed → 晚批 fail-closed 连坐 + 早批 ETL/reload 整链重跑）。
 * 单测 tests/wecom-sync-tasks.test.ts 锁定该不变式，改动此策略须先改测试并说明理由。
 * @param {{label:string, reason:string}[]} failures
 * @returns {{releaseBlocking: false, alertNeeded: boolean, note: string}}
 */
export function evaluateWecomOutcome(failures) {
  return {
    releaseBlocking: false,
    alertNeeded: failures.length > 0,
    note: failures.length > 0
      ? `WeCom ${failures.length} 个任务失败（非阻断）：${failures.map((f) => f.label).join('、')}`
      : '',
  };
}
