import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger.js';
import { duckdbService } from './duckdb.js';
import { setRouteCache } from './route-cache.js';
import { fetchDashboardBundleData } from '../routes/query.js';
import { QUERY_CACHE } from '../routes/query/shared.js';
import { getBootstrapper } from './bootstrapper-registry.js';
import { getDataVersion } from './data-version.js';
import { authConfig } from '../config/auth.js';
import { serverEnv } from '../config/env.js';

/**
 * 笛卡尔预热路由清单（GET，已包 withRouteCache 中间件）。
 *
 * **入选硬门槛**（修 Codex P1 后）：
 *   预热的 query string 必须与前端 hook 首屏真实请求**逐字节一致**，
 *   否则 buildRouteCacheKey 生成的 cache key 不同，预热无法命中真实流量。
 *   每条路由的 buildQuery 已对照 src/features/.../*hooks*.ts + src/shared/api/client.ts
 *   核对，注释里标注了来源。
 *
 * **暂不入选的路由**（待后续按真实参数协议补全）：
 *   - growth：必填 baselineStart/baselineEnd，前端默认值由业务逻辑决定
 *   - expense-development：前端用 cohortYears 而非日期
 *   - premium-plan：planYear/level/orgFilter 完全不同协议；handler 用 Promise.all 同时占 3 个连接，
 *     笛卡尔预热下易触发连接池耗尽（详见 PR #337 → revert）
 *   - quote-conversion/kpi、quote-conversion/funnel：触发 createDomainMiddleware('QuoteConversion')
 *     首次域加载，与 cache-warmer 并发竞争连接（同上事故）
 *   - performance-summary：segmentTag/timePeriod/growthMode 业务参数
 *   - marketing-report：必填 holidayDates，无固定默认值
 */
type WarmRange = { startDate: string; maxDate: string };
type RouteWarmConfig = {
    path: string;
    ttlMs: number;
    /**
     * 构造完整 query 参数对象。键名/值必须与前端 apiClient.* 调用真实输出对齐。
     * `org` 为 null 时表示"全公司"（不设 orgNames）。
     */
    buildQuery: (range: WarmRange, org: string | null) => Record<string, string>;
};

/** 通用 commonFilterSchema 协议：dateField + startDate + endDate + 可选 orgNames。 */
function commonFilterQuery(range: WarmRange, org: string | null): Record<string, string> {
    const q: Record<string, string> = {
        dateField: 'policy_date',
        startDate: range.startDate,
        endDate: range.maxDate,
    };
    if (org) q.orgNames = org;
    return q;
}

const COMMON_WARM_ROUTES: ReadonlyArray<RouteWarmConfig> = [
    {
        // 来源：useKpiData → buildFilterParams（commonFilterSchema 标准协议）
        path: '/api/query/kpi',
        ttlMs: QUERY_CACHE.hotspotShort,
        buildQuery: commonFilterQuery,
    },
    {
        // 来源：useTrendData → apiClient.getTrend(granularity, { ...buildFilterParams, perspective })
        // client.ts:530 把 { granularity } 合并进 query。首屏默认 timeView='daily' → 'day'，perspective='premium'
        path: '/api/query/trend',
        ttlMs: QUERY_CACHE.hotspotMedium,
        buildQuery: (range, org) => ({
            ...commonFilterQuery(range, org),
            granularity: 'day',
            perspective: 'premium',
        }),
    },
    {
        // 来源：usePolicyGeo → apiClient.getPolicyGeoProvince(buildFilterParams)
        path: '/api/query/policy-geo/province',
        ttlMs: QUERY_CACHE.hotspotMedium,
        buildQuery: commonFilterQuery,
    },
    {
        // 来源：useCostAnalysis → apiClient.getCostAnalysis(...)
        // 服务端 cost.ts 必填 cutoffDate（默认 = endDate）
        path: '/api/query/cost',
        ttlMs: QUERY_CACHE.hotspotMedium,
        buildQuery: (range, org) => ({
            ...commonFilterQuery(range, org),
            cutoffDate: range.maxDate,
        }),
    },
    {
        // 来源：useSalesmanRanking → apiClient.getSalesmanRanking(20, filters)
        // client.ts:609 把 { limit: '20' } 合并进 query；首屏默认 limit=20
        path: '/api/query/salesman-ranking',
        ttlMs: QUERY_CACHE.hotspotMedium,
        buildQuery: (range, org) => ({
            ...commonFilterQuery(range, org),
            limit: '20',
        }),
    },
    {
        // 来源：useRenewalTracker → apiClient.getRenewalTracker({ start, end, cutoff, ...filterParams })
        // 注意 query 协议与 commonFilterSchema 不同（start/end/cutoff，非 startDate/endDate/dateField），
        // 也不带 orgNames 时不发送（与前端 useNonTimeFilterParams 的 if filters.org_level_3.length>0 一致）。
        // 首屏 timeRange 默认 = { start: startDate, end: maxDate, cutoff: maxDate }（YTD）。
        path: '/api/query/renewal-tracker',
        ttlMs: QUERY_CACHE.hotspotMedium,
        buildQuery: (range, org) => {
            const q: Record<string, string> = {
                start: range.startDate,
                end: range.maxDate,
                cutoff: range.maxDate,
            };
            if (org) q.orgNames = org;
            return q;
        },
    },
];

/**
 * 机构维度：全公司 + 头部 5 个 org_level_3。
 * 选取依据：实测 13 个 org_level_3，头部 5 个占 ~85% 流量
 * （SQL: SELECT org_level_3, COUNT(*) FROM PolicyFact WHERE policy_date >= '2026-01-01'
 *  GROUP BY 1 ORDER BY 2 DESC）。
 */
const TOP_ORG_NAMES: ReadonlyArray<string> = ['天府', '宜宾', '高新', '青羊', '泸州'];

const WARM_CONCURRENCY = 4;
/**
 * 用 v8 heapUsed 而非 RSS 做安全阀：
 * RSS 包含 vite/DuckDB native 内存（本地动辄 4-5GB），不能反映 cache 实际占用。
 * heapUsed 才是 v8 持有的对象（含 LRU buffer），超过 2GB 即代表预热路径出问题，
 * 此时停止可避免 OOM。生产 PM2 max_memory_restart=3500MB 仍是兜底。
 */
const WARM_HEAP_LIMIT_MB = 2000;
const WARM_HEAP_CHECK_EVERY = 20;
const WARM_FETCH_TIMEOUT_MS = 15_000;

interface WarmCommonRoutesResult {
    written: number;
    skipped: number;
    failed: number;
    durationMs: number;
    rssStopped: boolean;
}

type QueryValue = string | number | boolean | null | undefined;

function buildSyntheticRouteCacheKey(
    routeName: string,
    permissionFilter: string,
    query: Record<string, QueryValue>
): string {
    const normalizedQuery = Object.entries(query)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => [key, String(value)] as const)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('&');
    // 与 buildRouteCacheKey（shared.ts）保持一致：版本后缀
    return `${routeName}|${permissionFilter || '1=1'}|${normalizedQuery}|v=${getDataVersion()}`;
}

/**
 * 后台智能预热服务
 * 在 DuckDB 加载完成基础数据后运行。
 * 第 1 层：生成和保存"绝对默认"的首屏缓存 (直接存表，0ms 极速响应)
 * 第 2 层：模拟高频条件的 API 请求组合，把算出的 JSON 塞进内存的 routeResponseCache (降至 <50ms)
 */
export class CacheWarmer {
    private isWarming = false;

    /**
     * 启动阻塞式关键路径预热。
     *
     * 目标不是构建静态 snapshot 文件，而是把真实 DuckDB 查询结果放入进程内
     * route cache，让首个页面请求也走毫秒级响应。
     */
    async warmStartupCritical(dataYear?: number) {
        if (this.isWarming) {
            logger.info('[CacheWarmer] Already running, skipped startup critical warming.');
            return;
        }

        this.isWarming = true;
        const startTime = Date.now();
        let startDate: string | undefined;
        let maxDate: string | null | undefined;
        try {
            ({ startDate, maxDate } = await this.resolveDefaultDateRange(dataYear));
            if (!maxDate) {
                logger.warn('[CacheWarmer] No data found, skipped startup critical warming.');
                return;
            }

            await this.ensureStartupDomainsLoaded();
            await this.warmDefaultDashboardRoute(startDate, maxDate);

            logger.info(`[CacheWarmer] Startup critical warming completed in ${Date.now() - startTime}ms.`);
        } catch (e) {
            logger.error('[CacheWarmer] Startup critical warming failed', e);
        } finally {
            this.isWarming = false;
        }

        // 异步扩展：Top 5 机构 dashboard 预热（不阻塞首次请求 readiness）
        if (startDate && maxDate) {
            this.warmTopOrgsBackground(startDate, maxDate, 5).catch((err) =>
                logger.warn('[CacheWarmer] Top-orgs background warming failed:', err)
            );
        }
    }

    /**
     * 后台异步预热 Top N 机构的默认 dashboard 视图。
     * 不持有 isWarming 锁（不阻塞 startup readiness 与下次 ETL trigger）。
     */
    private async warmTopOrgsBackground(startDate: string, maxDate: string, topN: number): Promise<void> {
        const startTime = Date.now();
        try {
            const topOrgsRes = await duckdbService.query<{ org_level_3: string }>(`
                SELECT org_level_3, SUM(premium) AS total
                FROM PolicyFact
                WHERE policy_date BETWEEN '${startDate}' AND '${maxDate}'
                GROUP BY org_level_3
                ORDER BY total DESC
                LIMIT ${topN}
            `);
            const topOrgs = topOrgsRes.map((r) => r.org_level_3).filter(Boolean);
            if (topOrgs.length === 0) return;

            // 上年同期日期窗（与 bundles.ts:493-507 对齐：日期平移 -1 年保留其他筛选）
            const prevStartDate = `${Number(startDate.slice(0, 4)) - 1}${startDate.slice(4)}`;
            const prevMaxDate = `${Number(maxDate.slice(0, 4)) - 1}${maxDate.slice(4)}`;

            for (const org of topOrgs) {
                try {
                    const escapedOrg = String(org).replace(/'/g, "''");
                    const whereWithDate = `policy_date >= '${startDate}' AND policy_date <= '${maxDate}' AND org_level_3 IN ('${escapedOrg}')`;
                    const whereWithoutDate = `org_level_3 IN ('${escapedOrg}')`;
                    const prevYearWhereWithDate = `policy_date >= '${prevStartDate}' AND policy_date <= '${prevMaxDate}' AND org_level_3 IN ('${escapedOrg}')`;
                    const payload = await fetchDashboardBundleData({
                        whereWithDate,
                        whereWithoutDate,
                        prevYearWhereWithDate,
                        orgNames: [org],
                        salesmanNames: [],
                        rankingLimit: 10,
                        timeView: 'weekly',
                        perspective: 'premium',
                        groupDim: undefined,
                        dateField: 'policy_date',
                    });

                    const baseQuery: Record<string, QueryValue> = {
                        dateField: 'policy_date',
                        startDate,
                        endDate: maxDate,
                        granularity: 'week',
                        perspective: 'premium',
                        orgNames: org,
                    };
                    const cacheKey = buildSyntheticRouteCacheKey('dashboard-bundle', '1=1', baseQuery);
                    setRouteCache(cacheKey, payload, QUERY_CACHE.hotspotLong);
                } catch (e) {
                    logger.warn(`[CacheWarmer] Top-orgs warm failed for org=${org}:`, e);
                }
            }
            logger.info(`[CacheWarmer] Top ${topOrgs.length} orgs warmed in ${Date.now() - startTime}ms (background).`);
        } catch (e) {
            logger.warn('[CacheWarmer] Top-orgs background warming aborted:', e);
        }
    }

    async runAll(dataYear: number) {
        if (this.isWarming) {
            logger.info('[CacheWarmer] Already running, skipped.');
            return;
        }

        this.isWarming = true;
        logger.info(`[CacheWarmer] Starting 3-Tier Pre-aggregation cache warming for year ${dataYear}...`);
        const startTime = Date.now();

        try {
            // 1. 获取动态的最大日期计算 Year-to-Date
            const maxDateResult = await duckdbService.query<{ max_date: string }>(
                `SELECT MAX(policy_date) as max_date FROM PolicyFact WHERE EXTRACT(YEAR FROM policy_date) = ${dataYear}`
            );
            const maxDateRaw = maxDateResult[0]?.max_date;
            if (!maxDateRaw) {
                logger.warn('[CacheWarmer] No data found for the year, stopping warming.');
                return;
            }
            // DuckDB DATE 格式可能为 YYYY-MM-DD
            const maxDate = typeof maxDateRaw === 'string' ? maxDateRaw.split(' ')[0] : '2026-12-31';
            const startDate = `${dataYear}-01-01`;

            logger.info(`[CacheWarmer] Deduced default date range: ${startDate} to ${maxDate}`);

            // ==== 阶段 1 (Tier 1): 绝对核心条件直接存物理表 ====
            await this.buildTier1HardCache(dataYear, startDate, maxDate);

            // ==== 阶段 2 (Tier 2): 高频次级别条件预读进内存 ====
            await this.buildTier2MemoryCache(dataYear, startDate, maxDate);

            const duration = Date.now() - startTime;
            logger.info(`[CacheWarmer] Completed successfully in ${duration}ms.`);
        } catch (e) {
            logger.error('[CacheWarmer] Failed to complete warming', e);
        } finally {
            this.isWarming = false;
        }
    }

    private async ensureStartupDomainsLoaded() {
        const bootstrapper = getBootstrapper();
        if (!bootstrapper) {
            logger.warn('[CacheWarmer] Bootstrapper not registered, skipped startup domain warming.');
            return;
        }

        // 当前 /api/query 挂载顺序会让 cross-sell 子路由 middleware 先于 bundle handler 执行。
        // 若这里不预载，首个 dashboard-bundle 即使 route cache 命中，也会先付出惰性域加载成本。
        await bootstrapper.ensureDomainLoaded('CrossSell');
        await bootstrapper.ensureDomainLoaded('ClaimsAgg');
        // RenewalTracker 进入笛卡尔预热（6 路由 × 6 机构），4 并发首次访问会同时触发
        // createDomainMiddleware('RenewalTracker') 域加载，加载本身需要连接池。
        // 此处先序列化加载，让 warmCommonRoutes 启动时域已就绪，仅消耗 1 个连接做实际查询。
        await bootstrapper.ensureDomainLoaded('RenewalTracker');
    }

    private async resolveDefaultDateRange(dataYear?: number): Promise<{ startDate: string; maxDate: string | null }> {
        const whereYear = dataYear ? `WHERE EXTRACT(YEAR FROM policy_date) = ${dataYear}` : '';
        const maxDateResult = await duckdbService.query<{ max_date: string }>(
            `SELECT MAX(policy_date) as max_date FROM PolicyFact ${whereYear}`,
            QUERY_CACHE.hotspotLong
        );
        const maxDateRaw = maxDateResult[0]?.max_date;
        const maxDate = maxDateRaw ? String(maxDateRaw).slice(0, 10) : null;
        const resolvedYear = dataYear || (maxDate ? Number(maxDate.slice(0, 4)) : new Date().getFullYear());
        return {
            startDate: `${resolvedYear}-01-01`,
            maxDate,
        };
    }

    private async warmDefaultDashboardRoute(startDate: string, maxDate: string) {
        logger.info(`[CacheWarmer] Warming default dashboard-bundle route: ${startDate} to ${maxDate}`);

        const whereWithDate = `policy_date >= '${startDate}' AND policy_date <= '${maxDate}'`;
        const whereWithoutDate = '1=1';
        const bundleData = await fetchDashboardBundleData({
            whereWithDate,
            whereWithoutDate,
            prevYearWhereWithDate: `policy_date >= '${String(Number(startDate.slice(0, 4)) - 1)}-01-01' AND policy_date <= '${String(Number(maxDate.slice(0, 4)) - 1)}${maxDate.slice(4)}'`,
            orgNames: [],
            salesmanNames: [],
            rankingLimit: 10,
            timeView: 'weekly',
            perspective: 'premium',
            groupDim: undefined,
            dateField: 'policy_date'
        });

        const baseQuery = {
            dateField: 'policy_date',
            startDate,
            endDate: maxDate,
            granularity: 'week',
            perspective: 'premium',
        };

        const queryVariants: Array<Record<string, QueryValue>> = [
            baseQuery,
            { ...baseQuery, rankingLimit: '10' },
        ];

        for (const query of queryVariants) {
            const cacheKey = buildSyntheticRouteCacheKey('dashboard-bundle', '1=1', query);
            setRouteCache(cacheKey, bundleData, QUERY_CACHE.hotspotLong);
        }

        logger.info(`[CacheWarmer] Default dashboard-bundle route cached (${queryVariants.length} key variants).`);
    }

    /**
     * 建立第一层硬缓存
     * 相当于直接给最纯净的首页条件生成完整的 bundle 回包。
     */
    private async buildTier1HardCache(dataYear: number, startDate: string, maxDate: string) {
        logger.info('[CacheWarmer] Building Tier 1 Physical Cache...');

        // 初始化缓存表
        await duckdbService.query(`
      CREATE TABLE IF NOT EXISTS DefaultDashboardCache (
        cache_key VARCHAR PRIMARY KEY,
        json_data VARCHAR,
        updated_at TIMESTAMP
      )
    `);

        // 默认大盘视角：
        // whereWithDate = policy_date >= startDate AND policy_date <= maxDate
        // whereWithoutDate = 1=1
        // orgNames = [], salesmanNames = []
        const whereWithDate = `policy_date >= '${startDate}' AND policy_date <= '${maxDate}'`;
        const whereWithoutDate = '1=1';

        logger.info('[CacheWarmer] Generating default Dashboard Bundle payload...');
        const bundleData = await fetchDashboardBundleData({
            whereWithDate,
            whereWithoutDate,
            orgNames: [],
            salesmanNames: [],
            rankingLimit: 10,
            timeView: 'weekly',
            perspective: 'premium',
            groupDim: undefined,
            dateField: 'policy_date'
        });

        const cacheKey = 'dashboard-bundle|default';
        const jsonStr = JSON.stringify(bundleData).replace(/'/g, "''"); // escape single quotes

        // 清空旧数据并插入
        await duckdbService.query(`DELETE FROM DefaultDashboardCache WHERE cache_key = '${cacheKey}'`);
        await duckdbService.query(`
      INSERT INTO DefaultDashboardCache (cache_key, json_data, updated_at)
      VALUES ('${cacheKey}', '${jsonStr}', CURRENT_TIMESTAMP)
    `);
        logger.info('[CacheWarmer] Tier 1 cache saved to duckdb.');
    }

    /**
     * 笛卡尔预热：高频 endpoint × 头部机构 × YTD 默认时窗。
     *
     * 通过本机 HTTP 自调用各路由，请求经 withRouteCache 中间件自动写入 LRU。
     * 零侵入路由 handler，单点失败容忍（catch 后继续），并发 ≤ 4，
     * RSS 安全阀防 OOM。在 app.listen 之后触发（warmStartupCritical 不阻塞）。
     *
     * 对外暴露用于：
     * 1) 启动 listen 回调中 setImmediate 触发（首次预热）
     * 2) onDataVersionChange 中 ETL 后追加触发（消除 cold cliff）
     */
    async warmCommonRoutes(): Promise<WarmCommonRoutesResult> {
        const start = Date.now();
        const result: WarmCommonRoutesResult = {
            written: 0,
            skipped: 0,
            failed: 0,
            durationMs: 0,
            rssStopped: false,
        };

        // 解析默认时窗（当年 YTD）
        let dateRange: { startDate: string; maxDate: string };
        try {
            const resolved = await this.resolveDefaultDateRange();
            if (!resolved.maxDate) {
                logger.warn('[CacheWarmer] warmCommonRoutes: no data, skipped.');
                result.durationMs = Date.now() - start;
                return result;
            }
            dateRange = { startDate: resolved.startDate, maxDate: resolved.maxDate };
        } catch (e) {
            logger.warn('[CacheWarmer] warmCommonRoutes: resolveDefaultDateRange failed:', e);
            result.failed += 1;
            result.durationMs = Date.now() - start;
            return result;
        }

        const tasks = this.buildCommonRouteTasks(dateRange);
        const token = signServiceToken();

        let stopped = false;
        let processed = 0;

        const runOne = async (task: { url: string; ttlMs: number; label: string }): Promise<void> => {
            if (stopped) {
                result.skipped += 1;
                return;
            }
            processed += 1;
            if (processed % WARM_HEAP_CHECK_EVERY === 0) {
                const heapMB = process.memoryUsage().heapUsed / 1024 / 1024;
                if (heapMB > WARM_HEAP_LIMIT_MB) {
                    stopped = true;
                    result.rssStopped = true;
                    logger.warn(
                        `[CacheWarmer] warmCommonRoutes stopped: heapUsed ${heapMB.toFixed(0)}MB > ${WARM_HEAP_LIMIT_MB}MB.`,
                    );
                    return;
                }
            }
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), WARM_FETCH_TIMEOUT_MS);
                try {
                    const res = await fetch(task.url, {
                        method: 'GET',
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'X-Cache-Warmup': '1',
                        },
                        signal: controller.signal,
                    });
                    if (res.ok) {
                        // 读完 body 触发 withRouteCache 中间件写入 LRU；丢弃数据本身
                        await res.arrayBuffer();
                        result.written += 1;
                    } else {
                        result.failed += 1;
                        logger.warn(
                            `[CacheWarmer] warm ${task.label} → HTTP ${res.status}`,
                        );
                    }
                } finally {
                    clearTimeout(timer);
                }
            } catch (e) {
                result.failed += 1;
                logger.warn(`[CacheWarmer] warm ${task.label} failed:`, e);
            }
        };

        await runWithConcurrency(tasks, WARM_CONCURRENCY, runOne);

        result.durationMs = Date.now() - start;
        logger.info(
            `[CacheWarmer] warmCommonRoutes done: written=${result.written}, skipped=${result.skipped}, failed=${result.failed}, ${result.durationMs}ms${result.rssStopped ? ' (RSS-stopped)' : ''}`,
        );
        return result;
    }

    /**
     * 构造预热任务清单。导出供单测验证组合数。
     *
     * 每条任务的 query string 由 route.buildQuery 完全控制，确保与前端 hook
     * 真实首屏请求逐字节一致（Codex P1 修复）。
     */
    buildCommonRouteTasks(
        dateRange: WarmRange,
        routes: ReadonlyArray<RouteWarmConfig> = COMMON_WARM_ROUTES,
        orgs: ReadonlyArray<string | null> = [null, ...TOP_ORG_NAMES],
    ): Array<{ url: string; ttlMs: number; label: string }> {
        const baseUrl = `http://127.0.0.1:${serverEnv.PORT}`;
        const tasks: Array<{ url: string; ttlMs: number; label: string }> = [];
        for (const route of routes) {
            for (const org of orgs) {
                const queryObj = route.buildQuery(dateRange, org);
                const params = new URLSearchParams();
                for (const [k, v] of Object.entries(queryObj)) params.set(k, v);
                tasks.push({
                    url: `${baseUrl}${route.path}?${params.toString()}`,
                    ttlMs: route.ttlMs,
                    label: `${route.path}${org ? ` org=${org}` : ' (all)'}`,
                });
            }
        }
        return tasks;
    }

    /**
     * 建立第二层内存预热
     */
    private async buildTier2MemoryCache(dataYear: number, startDate: string, maxDate: string) {
        logger.info('[CacheWarmer] Building Tier 2 Memory Cache for Top Organizations...');
        // 找出 Top 5 的机构
        const topOrgsRes = await duckdbService.query<{ org_level_3: string }>(`
      SELECT org_level_3, SUM(premium) as total
      FROM PolicyFact
      WHERE policy_date BETWEEN '${startDate}' AND '${maxDate}'
      GROUP BY org_level_3
      ORDER BY total DESC
      LIMIT 5
    `);

        const topOrgs = topOrgsRes.map(r => r.org_level_3).filter(Boolean);
        logger.info(`[CacheWarmer] Top 5 Orgs to warm up: ${topOrgs.join(', ')}`);

        // 我们模拟带有 orgFilter 的请求参数（这里的逻辑只需拼装好 route cache 即可）
        // 为了不引入 express 依赖，我们暂时手拼 cacheKey，与 query.ts 内一致
        for (const org of topOrgs) {
            const whereWithDate = `policy_date >= '${startDate}' AND policy_date <= '${maxDate}' AND org_level_3 IN ('${org}')`;

            const payload = await fetchDashboardBundleData({
                whereWithDate,
                whereWithoutDate: `org_level_3 IN ('${org}')`,
                orgNames: [org],
                salesmanNames: [],
                rankingLimit: 10,
                timeView: 'daily',
                perspective: 'premium',
                groupDim: undefined,
                dateField: 'policy_date'
            });

            // 对应的 API 请求 key，相当于 ?org_filter=["org"] 等，详见 frontend
            // 由于 req.query 我们拿不到，且为了命中缓存需模拟完全一致的 cache key，
            // 最简单安全的方式是在服务端直接预装最标准的查询字符串：
            const virtualQueryString = `date_criteria=policy_date&org_filter=["${org}"]&policy_date_end=${maxDate}&policy_date_start=${startDate}`;
            const cacheKey = `dashboard-bundle|1=1|${virtualQueryString}`;

            setRouteCache(cacheKey, payload, 300_000); // 存 5 分钟热度
            logger.info(`[CacheWarmer] Tier 2 Memory cached for org: ${org}`);
        }
    }
}

export const cacheWarmer = new CacheWarmer();

/**
 * 用 admin/branch_admin 身份自签 service token，专供 cache-warmer 自调用使用。
 * 不暴露密码，TTL 短（15 分钟，单轮预热足够）。
 */
function signServiceToken(): string {
    return jwt.sign(
        {
            userId: 'admin',
            username: 'admin',
            role: 'branch_admin',
        },
        authConfig.jwtSecret,
        { expiresIn: '15m' },
    );
}

/** 内部并发池：避免引入 p-limit 依赖。*/
async function runWithConcurrency<T>(
    items: ReadonlyArray<T>,
    limit: number,
    fn: (item: T) => Promise<void>,
): Promise<void> {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
            const i = cursor++;
            if (i >= items.length) return;
            await fn(items[i]);
        }
    });
    await Promise.all(workers);
}
