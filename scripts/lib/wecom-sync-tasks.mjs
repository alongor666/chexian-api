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

/**
 * 🔴 专用退出码契约（PR #1158 评审二轮 F1）：「核心数据发布成功 + 企微失败」时发布进程以
 * 此码退出（非 0、非 1）——手动入口（bun run release:daily / sync-and-reload）不再静默成功，
 * shell/自动化能区分三种终态：0=全成功、86=核心成功仅企微失败、其他=核心发布失败。
 * 86 刻意避开 sysexits(3) 保留区（64-78，尤其 launchd EX_CONFIG=78 在本项目有历史含义）。
 */
export const WECOM_FAILURE_EXIT_CODE = 86;

/**
 * watcher 侧退出码解释器（auto-release-daily runReleaseDaily 消费）：
 * 把发布子进程退出码翻译为两个独立结果——coreReleased 决定批次 released/failed
 * （企微失败不连坐晚批），wecomFailed 决定是否独立告警。
 * @param {number|null} status spawnSync 返回的 exit status（进程被杀等异常时为 null）
 * @returns {{coreReleased: boolean, wecomFailed: boolean}}
 */
export function interpretReleaseExit(status) {
  if (status === 0) return { coreReleased: true, wecomFailed: false };
  if (status === WECOM_FAILURE_EXIT_CODE) return { coreReleased: true, wecomFailed: true };
  return { coreReleased: false, wecomFailed: false };
}

/**
 * Stage 5 企微同步编排——发布链（sync-and-reload）与独立重试入口（wecom-sync）共用的
 * **真实执行体**；runner / persistMarker 可注入，使真实链路可被单测注入失败复现：
 * 「企微子任务失败 → 不抛错 → 返回 WECOM_FAILURE_EXIT_CODE + 标记落盘」整条路径都在本函数内，
 * 恢复旧的 throw 行为会直接打红对应测试（tests/wecom-sync-tasks.test.ts）。
 *
 * @param {object} opts
 * @param {boolean} [opts.dryRun] 全局 dry-run（连 python 子进程都不跑；由 runner 自行尊重）
 * @param {boolean} [opts.wecomDryRun] 企微级 dry-run（python 侧 --dry-run）
 * @param {string|null} [opts.org] 机构续保表限定机构
 * @param {string|null} opts.todayBeijing 北京日（YYYY-MM-DD）
 * @param {string} [opts.runId] 本次发布 run_id（watcher 经 ETL_RUN_ID 注入；标记文件据此绑定，
 *   避免消费陈旧/并发运行的结果）
 * @param {(task: {label:string,args:string[],timeoutMs:number}) => Promise<unknown>} opts.runner
 *   单任务执行器（必注入）：sync-and-reload 传 runCmd 包装，wecom-sync 传本地 spawn，测试传桩
 * @param {(marker: {beijingDay:string|null,runId:string,failures:{label:string,reason:string}[],updatedAt:string}) => void} [opts.persistMarker]
 *   标记文件写入器；dry-run（全局或企微级）不调用（演练不污染真实告警态）；写失败由本函数吞掉（非阻断）
 * @param {(level: 'info'|'warn'|'error', msg: string) => void} [opts.log] 日志器
 * @returns {Promise<{failures:{label:string,reason:string}[], outcome:ReturnType<typeof evaluateWecomOutcome>,
 *   exitCode: 0|typeof WECOM_FAILURE_EXIT_CODE, activeCount:number, totalCount:number}>}
 */
export async function runWecomStage({
  dryRun = false,
  wecomDryRun = false,
  org = null,
  todayBeijing,
  runId = 'adhoc',
  runner,
  persistMarker,
  log = () => {},
}) {
  const allTasks = buildWecomTasks({ dryRun: wecomDryRun, org });
  const { active, retired } = filterActiveWecomTasks(allTasks, todayBeijing);
  for (const task of retired) {
    log('warn', `  ⏹ 跳过「${task.label}」：已过停推日 ${task.retireAfterBeijingDay}（北京今天 ${todayBeijing}），该表已退役。`);
  }

  log('info', `\n▶ [WeCom] 并行启动 ${active.length}/${allTasks.length} 个智能表格同步任务`);
  const results = await Promise.allSettled(active.map((task) => runner(task)));
  const failures = summarizeWecomFailures(results, active);
  const outcome = evaluateWecomOutcome(failures);

  // 标记文件：失败写清单、成功清空（幂等覆盖当天态），绑定 runId 防消费陈旧/并发结果。
  if (!dryRun && !wecomDryRun && typeof persistMarker === 'function') {
    try {
      persistMarker({ beijingDay: todayBeijing, runId, failures, updatedAt: new Date().toISOString() });
    } catch (e) {
      log('warn', `  ⚠ 企微告警标记写入失败（不阻断）：${e.message}`);
    }
  }

  if (failures.length > 0) {
    for (const f of failures) log('error', `  ❌ ${f.label}: ${f.reason}`);
    log('warn', `⚠ 企微同步 ${failures.length}/${active.length} 个任务失败——按非阻断策略继续（核心数据发布不受影响，晚批不被连坐）。`);
    log('warn', '  独立重试（只跑企微，不重跑 ETL/reload）：node scripts/wecom-sync.mjs');
  } else {
    log('info', `  ✓ WeCom 全部 ${active.length} 个任务完成`);
  }

  return {
    failures,
    outcome,
    exitCode: failures.length > 0 ? WECOM_FAILURE_EXIT_CODE : 0,
    activeCount: active.length,
    totalCount: allTasks.length,
  };
}

/**
 * watcher 独立告警文案构建（auto-release-daily 在 interpretReleaseExit().wecomFailed 时调用）。
 * 标记文件新鲜（北京日相符，且 runId 相符或未提供）→ 带具体失败表名；陈旧/缺失/损坏 → 通用文案
 * （告警不因标记问题而丢失）。
 * @param {{beijingDay?:string, runId?:string, failures?:{label:string}[]}|null} marker
 * @param {{todayBeijing: string|null, runId?: string|null}} ctx
 * @returns {{title: string, body: string}}
 */
export function buildWecomFailureAlert(marker, { todayBeijing, runId = null }) {
  const title = '企微同步部分失败（发布未受阻断）';
  const fresh = marker
    && marker.beijingDay === todayBeijing
    && (!runId || !marker.runId || marker.runId === runId)
    && Array.isArray(marker.failures)
    && marker.failures.length > 0;
  const detail = fresh
    ? `${marker.failures.map((f) => f.label).join('、')} 失败`
    : '企微同步存在失败任务（标记文件缺失或陈旧，详见发布日志）';
  return {
    title,
    body: `${detail}；核心数据已正常发布。独立重试：node scripts/wecom-sync.mjs（不重跑 ETL/reload）`,
  };
}
