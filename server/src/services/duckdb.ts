/**
 * DuckDB 服务
 * DuckDB Service with Connection Pool
 *
 * 提供DuckDB连接管理和查询执行功能
 */

import duckdb from 'duckdb';
import { databaseConfig, DUCKDB_INIT_OPTIONS } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import { tableFromIPC } from 'apache-arrow';
import { generateColumnMappingSQL, getColumnMapping } from './column-normalizer.js';
import { sanitizeTableName, escapeSqlValue } from '../utils/security.js';

/**
 * DuckDB服务类（单例）
 */
class DuckDBService {
  private db: duckdb.Database | null = null;
  private connections: duckdb.Connection[] = [];
  private isInitialized = false;

  /**
   * 初始化数据库连接
   */
  async init(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.db = new duckdb.Database(databaseConfig.path, (err) => {
        if (err) {
          reject(new AppError(500, `Failed to initialize DuckDB: ${err.message}`));
          return;
        }

        console.log('[DuckDB] Database initialized:', databaseConfig.path);
        this.isInitialized = true;
        resolve();
      });
    });
  }

  /**
   * 获取数据库连接
   */
  private async getConnection(): Promise<duckdb.Connection> {
    if (!this.db) {
      throw new AppError(500, 'DuckDB not initialized');
    }

    return new Promise((resolve, reject) => {
      const conn = this.db!.connect();
      if (!conn) {
        reject(new AppError(500, 'Failed to create connection'));
        return;
      }
      resolve(conn);
    });
  }

  /**
   * 执行SQL查询（返回JSON格式）
   */
  async query<T = any>(sql: string): Promise<T[]> {
    const conn = await this.getConnection();

    return new Promise((resolve, reject) => {
      conn.all(sql, (err, result) => {
        // 关闭连接
        conn.close();

        if (err) {
          console.error('[DuckDB] Query error:', err.message);
          reject(new AppError(400, `Query failed: ${err.message}`));
          return;
        }

        // 转换BigInt为Number（避免JSON序列化错误）
        const sanitized = this.convertBigIntToNumber(result);
        resolve(sanitized as T[]);
      });
    });
  }

  /**
   * 将结果中的BigInt转换为Number
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
      const converted: any = {};
      for (const [key, value] of Object.entries(data)) {
        converted[key] = this.convertBigIntToNumber(value);
      }
      return converted;
    }

    return data;
  }

  /**
   * 执行SQL查询（返回Arrow IPC格式）
   * 用于大数据量传输，性能更优
   */
  async queryArrow(sql: string): Promise<any> {
    const conn = await this.getConnection();

    return new Promise((resolve, reject) => {
      conn.arrowIPCAll(sql, (err, result) => {
        // 关闭连接
        conn.close();

        if (err) {
          console.error('[DuckDB] Arrow query error:', err.message);
          reject(new AppError(400, `Arrow query failed: ${err.message}`));
          return;
        }

        // 将Arrow IPC Buffer转换为Table
        const table = tableFromIPC(result);
        resolve(table);
      });
    });
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
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
      console.log('[DuckDB] Database closed');
    }
  }
}

// 导出单例实例
export const duckdbService = new DuckDBService();
