/**
 * 每日发布「批次」SSOT（2026-07-18 上游 BI 导出改双批调度后引入）
 *
 * 背景：上游华安 BI 导出（VPS auto_loadbi）从「五张表一次出齐」改为两批出表：
 *   - 早批：01 签单 + 05 理赔，北京约 07:00~07:35 两省就绪
 *   - 晚批：02 报价 + 03 维修 + 04 厂牌，北京约 11:50 两省就绪（04 每周日更新，见 README-for-etl §2）
 * 故本项目每日发布/ETL 从「一次 release:daily 跑全部域」拆成「早批 + 晚批」两次发布，
 * 各自独立的：就绪判定（只看本批 code）/ 幂等键（北京日 × 批次）/ 触发窗口。
 *
 * 本文件是唯一事实源：watcher（探测就绪 + 批次决策）、pull-bi-exports（拉取/校验子集）、
 * sync-and-reload（选 ETL 域 + 报告/企微编排）都从此读，禁止各自硬编码 code / 域清单。
 *
 * 无副作用、不读文件系统 / env / 时钟，可被 vitest 直接 import。
 */

/**
 * 早批：签单(01→premium) + 理赔(05→claims_detail)。北京约 07:35 上游就绪，07:40 起触发。
 * scDomains 顺序即 ETL 执行序：claims_detail 富集依赖 policy（VIN/保单号 JOIN 回填 org_level_3），
 * 故 premium 必须在前。早批不跑企微续保表（依赖报价/续保追踪，属晚批）。
 */
export const EARLY_BATCH = Object.freeze({
  id: 'early',
  label: '早批·签单+理赔',
  hardCodes: Object.freeze(['01', '05']),
  optionalCodes: Object.freeze([]),
  scDomains: Object.freeze(['premium', 'claims_detail']),
  window: Object.freeze({ start: '07:40', end: '20:00' }),
  runReport: true,
  runWecom: false,
  // 依赖的前置批次 id（须当天 released 才可发本批）；早批无前置。
  dependsOn: Object.freeze([]),
});

/**
 * 晚批：报价(02→quotes) + 维修(03→repair) + 厂牌(04→brand) + 其余尾部域。
 * - 04 厂牌是可选表：mtime 非今天（周一至周六停在上周日）→ 告警 + 跳过分发保留旧维表，不阻塞；
 *   仅周日 mtime=当天时才分发（语义由 bi-export-pull OPTIONAL_REPORT_CODES 承担，本批把 04 列为 optional）。
 * - cross_sell / customer_flow / new_energy_claims 源不来自 auto_loadbi（各自独立源/全量快照），
 *   但原 `daily.mjs all` 覆盖它们，拆批后归晚批统一收口，不能遗漏。
 * - renewal_tracker 派生域依赖 policy(早批产出) + quotes + salesman，必须排最后。
 * 北京约 11:50 上游就绪，12:00 起触发。
 */
export const LATE_BATCH = Object.freeze({
  id: 'late',
  label: '晚批·报价+维修+厂牌',
  hardCodes: Object.freeze(['02', '03']),
  optionalCodes: Object.freeze(['04']),
  scDomains: Object.freeze([
    'quotes', 'cross_sell', 'brand', 'repair', 'customer_flow', 'new_energy_claims', 'renewal_tracker',
  ]),
  window: Object.freeze({ start: '12:00', end: '20:00' }),
  runReport: true,
  runWecom: true,
  // 🔴 依赖早批：renewal_tracker / new_energy_claims 依赖早批产出的 policy(current)，
  // 早批当天未 released 就发晚批 = 用陈旧 policy 重算续保追踪 + 推 5 个企微表（混新鲜度发布）。
  // 故晚批 fail-closed：早批当天未 released 则不发（watcher 自动 / 手动入口均校验），
  // 应急可 --allow-missing-dep 显式放行。
  dependsOn: Object.freeze(['early']),
});

/** 批次全集（顺序 = watcher 每 tick 的处理顺序：早批在前，晚批在后）。 */
export const RELEASE_BATCHES = Object.freeze([EARLY_BATCH, LATE_BATCH]);

/** 合法批次 id 全集。 */
export const RELEASE_BATCH_IDS = Object.freeze(RELEASE_BATCHES.map((b) => b.id));

/**
 * 按 id 取批次配置；未知 id 抛错（fail-closed，禁默认回落，与省份解析同纪律）。
 * @param {string} id
 * @returns {typeof EARLY_BATCH}
 */
export function getReleaseBatch(id) {
  const batch = RELEASE_BATCHES.find((b) => b.id === id);
  if (!batch) {
    throw new Error(`未知发布批次：${id}（合法值 ${RELEASE_BATCH_IDS.join('/')}）`);
  }
  return batch;
}

/**
 * 批次涉及的全部上游 code（硬闸 + 可选），用于 pull 拉取子集 / watcher 探测子集。
 * @param {{hardCodes:readonly string[], optionalCodes:readonly string[]}} batch
 * @returns {string[]}
 */
export function batchAllCodes(batch) {
  return [...batch.hardCodes, ...batch.optionalCodes];
}
