import { Request, Response } from 'express';
import { logger } from '../utils/logger.js';
import { duckdbService } from './duckdb.js';
import { setRouteCache } from './route-cache.js';
import { fetchDashboardBundleData } from '../routes/query.js';
import { generateKpiQuery } from '../sql/kpi.js';

/**
 * 后台智能预热服务
 * 在 DuckDB 加载完成基础数据后运行。
 * 第 1 层：生成和保存"绝对默认"的首屏缓存 (直接存表，0ms 极速响应)
 * 第 2 层：模拟高频条件的 API 请求组合，把算出的 JSON 塞进内存的 routeResponseCache (降至 <50ms)
 */
export class CacheWarmer {
    private isWarming = false;

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
            timeView: 'daily',
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
