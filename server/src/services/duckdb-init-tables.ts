/**
 * DuckDB 初始化建表逻辑
 *
 * 处理 init() 阶段的三张表创建：KpiPlanConfig / UserAccount / RoleConfig。
 * 从 duckdb.ts 拆出，接受 DuckDBQueryable 接口，零主类依赖。
 */

import type { DuckDBQueryable } from './duckdb-types.js';
import { escapeSqlValue } from '../utils/security.js';
import { getKpiPlanConfigPath } from '../config/paths.js';

/**
 * 创建并初始化 KpiPlanConfig / UserAccount / RoleConfig 三张表。
 * 同时加载 KpiPlanConfig 的 JSON 数据。
 */
export async function initDuckDBTables(db: DuckDBQueryable): Promise<void> {
  // KPI 计划配置表（用于核心指标中的车驾意达成率，支持多层级扩展）
  await db.query(`
    CREATE TABLE IF NOT EXISTS KpiPlanConfig (
      plan_year INTEGER,
      business_line VARCHAR,
      level VARCHAR,
      level_key VARCHAR,
      plan_premium DOUBLE
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS UserAccount (
      id VARCHAR,
      username VARCHAR,
      display_name VARCHAR,
      password_hash VARCHAR,
      role VARCHAR,
      organization VARCHAR,
      branch_code VARCHAR,
      allowed_routes VARCHAR,
      default_route VARCHAR,
      allowed_ips VARCHAR,
      special_features VARCHAR,
      active BOOLEAN,
      created_at TIMESTAMP,
      updated_at TIMESTAMP
    )
  `);

  // 迁移：已有表可能缺少 special_features 列
  try {
    await db.query(`ALTER TABLE UserAccount ADD COLUMN IF NOT EXISTS special_features VARCHAR`);
  } catch {
    // 列已存在或表刚创建，忽略
  }

  // 迁移：plan v2 多分公司前置（0D），已有表补 branch_code 列
  try {
    await db.query(`ALTER TABLE UserAccount ADD COLUMN IF NOT EXISTS branch_code VARCHAR`);
  } catch {
    // 列已存在或表刚创建，忽略
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS RoleConfig (
      role VARCHAR,
      name VARCHAR,
      data_scope VARCHAR,
      allowed_routes VARCHAR,
      default_route VARCHAR,
      created_at TIMESTAMP,
      updated_at TIMESTAMP
    )
  `);

  // Personal Access Token：只读 API 长期令牌
  // token_hash = bcrypt(secret)，secret 仅在创建时返回明文一次
  await db.query(`
    CREATE TABLE IF NOT EXISTS ApiToken (
      token_id VARCHAR PRIMARY KEY,
      token_hash VARCHAR NOT NULL,
      user_id VARCHAR NOT NULL,
      username VARCHAR NOT NULL,
      name VARCHAR NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      last_used_at TIMESTAMP,
      last_used_ip VARCHAR,
      created_at TIMESTAMP NOT NULL,
      revoked_at TIMESTAMP
    )
  `);

  // 加载 KpiPlanConfig JSON 数据
  try {
    const fs = (await import('fs')).default;
    const planConfigPath = getKpiPlanConfigPath();
    if (fs.existsSync(planConfigPath)) {
      const raw = fs.readFileSync(planConfigPath, 'utf-8').replace(/\bNaN\b/g, 'null');
      const parsed = JSON.parse(raw);
      const rows: any[] = Array.isArray(parsed) ? parsed : [];
      if (rows.length > 0) {
        await db.query('DELETE FROM KpiPlanConfig');
        const values = rows
          .filter((r) => r && typeof r === 'object')
          .map((r) => {
            const planYear = Number(r.plan_year) || 0;
            const businessLine = String(r.business_line ?? '');
            const level = String(r.level ?? '');
            const levelKey = String(r.level_key ?? '');
            const planPremium = Number(r.plan_premium) || 0;
            return `(${planYear}, '${escapeSqlValue(businessLine)}', '${escapeSqlValue(level)}', '${escapeSqlValue(levelKey)}', ${planPremium})`;
          })
          .join(',\n');
        if (values) {
          await db.query(`INSERT INTO KpiPlanConfig VALUES\n${values}`);
        }
      }
    }
  } catch {
    // 文件不存在或解析失败，忽略
  }
}
