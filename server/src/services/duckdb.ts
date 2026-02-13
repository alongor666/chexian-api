/**
 * DuckDB 服务 (@duckdb/node-api)
 *
 * 从 legacy duckdb 包迁移到 @duckdb/node-api (Neo)：
 * - NAPI 预编译二进制，不依赖 Node.js 版本（18/20/22/25+ 均可）
 * - Promise 原生支持，无需回调包装
 * - 已移除 queryArrow（死代码）和 apache-arrow 依赖
 */

import { DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBConnection } from '@duckdb/node-api';
import { databaseConfig } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import { generateColumnMappingSQL, getColumnMapping } from './column-normalizer.js';
import { sanitizeTableName, escapeSqlValue } from '../utils/security.js';

/**
 * DuckDB服务类（单例）
 */
class DuckDBService {
  private instance: DuckDBInstance | null = null;
  private isInitialized = false;

  /**
   * 初始化数据库连接
   */
  async init(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      this.instance = await DuckDBInstance.create(databaseConfig.path);
      console.log('[DuckDB] Database initialized:', databaseConfig.path);
      this.isInitialized = true;
    } catch (err: any) {
      throw new AppError(500, `Failed to initialize DuckDB: ${err.message}`);
    }
  }

  /**
   * 获取数据库连接
   */
  private async getConnection(): Promise<DuckDBConnection> {
    if (!this.instance) {
      throw new AppError(500, 'DuckDB not initialized');
    }

    return await this.instance.connect();
  }

  /**
   * 执行SQL查询（返回JSON格式）
   */
  async query<T = any>(sql: string): Promise<T[]> {
    const conn = await this.getConnection();

    try {
      const reader = await conn.runAndReadAll(sql);
      const result = reader.getRowObjects();

      // 转换BigInt为Number（避免JSON序列化错误）
      return this.convertBigIntToNumber(result) as T[];
    } catch (err: any) {
      console.error('[DuckDB] Query error:', err.message);
      throw new AppError(400, `Query failed: ${err.message}`);
    } finally {
      conn.closeSync();
    }
  }

  /**
   * 转换 DuckDB 特殊类型为 JSON 可序列化的值
   * - BigInt → Number
   * - DuckDB DATE {days: N} → "YYYY-MM-DD" 字符串
   * - DuckDB TIMESTAMP {micros: N} → ISO 字符串
   */
  private convertBigIntToNumber(data: any): any {
    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data === 'bigint') {
      return Number(data);
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.convertBigIntToNumber(item));
    }

    if (typeof data === 'object') {
      const keys = Object.keys(data);

      // DuckDB DATE type: {days: number} → "YYYY-MM-DD"
      if (keys.length === 1 && keys[0] === 'days' && typeof data.days === 'number') {
        const ms = data.days * 86400000;
        return new Date(ms).toISOString().split('T')[0];
      }

      // DuckDB TIMESTAMP type: {micros: bigint|number} → ISO string
      if (keys.length === 1 && keys[0] === 'micros' && (typeof data.micros === 'bigint' || typeof data.micros === 'number')) {
        const ms = Number(data.micros) / 1000;
        return new Date(ms).toISOString();
      }

      const converted: any = {};
      for (const [key, value] of Object.entries(data)) {
        converted[key] = this.convertBigIntToNumber(value);
      }
      return converted;
    }

    return data;
  }

  /**
   * 加载Parquet文件
   *
   * 安全修复：
   * 1. 表名验证（防止 SQL 注入）
   * 2. 文件路径转义（防止单引号注入）
   */
  async loadParquet(filePath: string, tableName: string = 'raw_parquet'): Promise<void> {
    // 1. 验证表名（防止 SQL 注入）
    const safeTableName = sanitizeTableName(tableName);

    // 2. 转义文件路径中的单引号
    const escapedPath = escapeSqlValue(filePath);

    const sql = `
      CREATE OR REPLACE TABLE ${safeTableName} AS
      SELECT * FROM read_parquet('${escapedPath}')
    `;

    await this.query(sql);
    console.log(`[DuckDB] Loaded Parquet file: ${filePath} -> ${safeTableName}`);
  }

  /**
   * 创建PolicyFact视图（带列名映射和去重）
   *
   * @param sourceTable 源表名
   *
   * 安全修复：表名验证（防止 SQL 注入）
   */
  async createPolicyFactView(sourceTable: string = 'raw_parquet'): Promise<void> {
    // 1. 验证表名（防止 SQL 注入）
    const safeSourceTable = sanitizeTableName(sourceTable);

    // 获取表结构
    const schema = await this.getTableSchema(safeSourceTable);
    const actualColumns = schema.map((col: any) => col.column_name);

    console.log('[DuckDB] Actual columns:', actualColumns.slice(0, 5).join(', '), '...');

    // 检查是否需要列名映射（如果第一列是中文）
    const needsMapping = /[\u4e00-\u9fa5]/.test(actualColumns[0] || '');

    if (needsMapping) {
      console.log('[DuckDB] Chinese column names detected, creating normalized view...');

      // 获取列名映射
      const mapping = getColumnMapping(actualColumns);
      console.log('[DuckDB] Column mapping created:', Object.keys(mapping).length, 'fields');

      // 生成列名映射SQL（使用验证后的表名）
      const mappingSQL = generateColumnMappingSQL(safeSourceTable, actualColumns);
      await this.query(mappingSQL);

      console.log('[DuckDB] PolicyFact view created with column mapping');
    } else {
      // 英文列名，直接创建视图（使用验证后的表名）
      const sql = `
        CREATE OR REPLACE VIEW PolicyFact AS
        SELECT * FROM ${safeSourceTable}
      `;
      await this.query(sql);
      console.log('[DuckDB] PolicyFact view created (pass-through mode)');
    }
  }

  /**
   * 获取表结构
   *
   * 安全修复：表名验证
   */
  async getTableSchema(tableName: string): Promise<any[]> {
    const safeTableName = sanitizeTableName(tableName);
    const sql = `DESCRIBE ${safeTableName}`;
    return this.query(sql);
  }

  /**
   * 加载团队映射 JSON 到 SalesmanTeamMapping 表
   *
   * 数据源：数据管理/warehouse/dim/业务员归属与规划/salesman_organization_mapping.json
   * 字段：business_no, salesman_name, full_name, team_name, organization, car_insurance_plan_2026
   * JOIN 键：full_name = PolicyFact.salesman_name（含工号前缀）
   */
  async loadTeamMapping(jsonFilePath: string): Promise<void> {
    const fs = (await import('fs')).default;

    let data: any;
    try {
      data = JSON.parse(fs.readFileSync(jsonFilePath, 'utf-8'));
    } catch (err: any) {
      console.warn(`[DuckDB] Failed to read team mapping: ${err.message}`);
      return;
    }

    const rows: any[] = data.salesman_mapping || [];
    if (rows.length === 0) {
      console.warn('[DuckDB] No team mapping data found');
      return;
    }

    // 创建表
    await this.query(`
      CREATE OR REPLACE TABLE SalesmanTeamMapping (
        business_no VARCHAR,
        salesman_name VARCHAR,
        full_name VARCHAR,
        team_name VARCHAR,
        organization VARCHAR,
        car_insurance_plan_2026 DOUBLE
      )
    `);

    // 批量 INSERT（单条 SQL，234 行足够安全）
    const values = rows.map(r => {
      const esc = (s: any) => String(s ?? '').replace(/'/g, "''");
      return `('${esc(r.business_no)}', '${esc(r.salesman_name)}', '${esc(r.full_name)}', '${esc(r.team)}', '${esc(r.organization)}', ${Number(r.car_insurance_plan_2026) || 0})`;
    }).join(',\n      ');

    await this.query(`INSERT INTO SalesmanTeamMapping VALUES\n      ${values}`);
    console.log(`[DuckDB] Team mapping loaded: ${rows.length} records, from ${jsonFilePath}`);
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    if (this.instance) {
      this.instance = null;
      this.isInitialized = false;
      console.log('[DuckDB] Database closed');
    }
  }
}

// 导出单例实例
export const duckdbService = new DuckDBService();
