#!/usr/bin/env node
/**
 * 续保率数据诊断脚本
 *
 * 用途：诊断为什么续保率为空
 */

import * as duckdb from 'duckdb';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PARQUET_FILE = join(__dirname, '../签单清洗/优化处理后的业务数据.parquet');

async function diagnose() {
  const db = new duckdb.Database(':memory:');
  const conn = db.connect();

  return new Promise((resolve, reject) => {
    console.log('📊 开始诊断续保率数据...\n');

    // 1. 加载 Parquet 文件
    conn.run(`CREATE TABLE raw_data AS SELECT * FROM read_parquet('${PARQUET_FILE}')`, (err) => {
      if (err) {
        console.error('❌ 加载 Parquet 失败:', err);
        reject(err);
        return;
      }

      console.log('✅ Parquet 文件加载成功\n');

      // 2. 检查数据年份分布
      console.log('=== 1. 起保年份分布 ===');
      conn.all(`
        SELECT
          YEAR(CAST(保险起期 AS DATE)) as start_year,
          COUNT(*) as policy_count
        FROM raw_data
        GROUP BY start_year
        ORDER BY start_year
      `, (err, rows) => {
        if (err) {
          console.error('查询失败:', err);
        } else {
          console.table(rows);
        }

        // 3. 检查 renewal_policy_no 字段
        console.log('\n=== 2. 续保单号字段统计 ===');
        conn.all(`
          SELECT
            COUNT(*) as total_policies,
            COUNT("续保单号") as has_renewal_no_column,
            COUNT(CASE WHEN "续保单号" IS NOT NULL AND "续保单号" <> '' THEN 1 END) as has_valid_renewal_no
          FROM raw_data
        `, (err, rows) => {
          if (err) {
            console.error('查询失败:', err);
          } else {
            console.table(rows);
          }

          // 4. 查看 renewal_policy_no 样本数据
          console.log('\n=== 3. 续保单号样本数据（前10条） ===');
          conn.all(`
            SELECT
              "保单号",
              "续保单号",
              "保险起期",
              YEAR(CAST("保险起期" AS DATE)) as start_year
            FROM raw_data
            WHERE "续保单号" IS NOT NULL AND "续保单号" <> ''
            LIMIT 10
          `, (err, rows) => {
            if (err) {
              console.error('查询失败:', err);
            } else {
              if (rows.length === 0) {
                console.log('⚠️  没有找到有效的续保单号数据');
              } else {
                console.table(rows);
              }
            }

            // 5. 检查保单号和续保单号的匹配情况
            console.log('\n=== 4. 保单号和续保单号匹配测试 ===');
            conn.all(`
              WITH policies_2024 AS (
                SELECT "保单号", "保险起期"
                FROM raw_data
                WHERE YEAR(CAST("保险起期" AS DATE)) = 2024
                LIMIT 5
              ),
              policies_2025 AS (
                SELECT "保单号", "续保单号", "保险起期"
                FROM raw_data
                WHERE YEAR(CAST("保险起期" AS DATE)) = 2025
                  AND "续保单号" IS NOT NULL
                  AND "续保单号" <> ''
                LIMIT 5
              )
              SELECT
                p2025."保单号" as policy_2025,
                p2025."续保单号" as renewal_no,
                p2024."保单号" as matched_policy_2024,
                p2025."保险起期" as start_2025,
                p2024."保险起期" as start_2024
              FROM policies_2025 p2025
              LEFT JOIN policies_2024 p2024
                ON p2025."续保单号" = p2024."保单号"
            `, (err, rows) => {
              if (err) {
                console.error('查询失败:', err);
              } else {
                if (rows.length === 0) {
                  console.log('⚠️  没有找到2024-2025年的续保匹配数据');
                } else {
                  console.table(rows);
                }
              }

              // 6. 检查所有列名
              console.log('\n=== 5. 数据列名 ===');
              conn.all(`
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'raw_data'
                ORDER BY ordinal_position
              `, (err, rows) => {
                if (err) {
                  console.error('查询失败:', err);
                } else {
                  console.log('列名列表:', rows.map(r => r.column_name).join(', '));
                }

                conn.close();
                db.close();
                console.log('\n✅ 诊断完成');
                resolve();
              });
            });
          });
        });
      });
    });
  });
}

diagnose().catch(err => {
  console.error('诊断失败:', err);
  process.exit(1);
});
