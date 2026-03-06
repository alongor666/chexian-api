#!/usr/bin/env node
/**
 * 驾乘险推介率日报生成器
 * 
 * 功能：
 * 1. 读取最近15天的数据
 * 2. 筛选条件：险种大类 = 商业险
 * 3. 按三级机构分组统计：
 *    - 推介率 = driver_count / auto_count * 100（车架号去重）
 *    - 件均保费 = driver_premium / driver_policy_count
 *    - 驾乘险件数 = driver_policy_count
 * 4. 输出 CSV 格式
 * 
 * 指标口径（与项目一致）：
 * - auto_count: 车险承保车辆数（去重车架号）
 * - driver_count: 驾乘险承保车辆数（去重车架号）
 * - driver_policy_count: 驾乘险保单件数
 * - driver_premium: 驾乘险保费
 * - auto_premium: 车险保费
 */

import duckdb from 'duckdb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 配置
const CONFIG = {
  dataPath: path.join(__dirname, 'warehouse/fact/policy/current/每日数据_20250101_20260304.parquet'),
  outputPath: path.join(__dirname, '数据分析报告'),
  daysToAnalyze: 15,  // 改为15天
  timezone: 'Asia/Shanghai'
};

/**
 * 初始化 DuckDB 连接
 */
async function initDB() {
  return new Promise((resolve, reject) => {
    const db = new duckdb.Database(':memory:', (err) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
}

/**
 * 查询最近15天的驾乘险数据
 * 指标口径与项目定义保持一致
 */
async function queryData(db) {
  return new Promise((resolve, reject) => {
    const sql = `
      WITH daily_stats AS (
        SELECT 
          org_level_3 AS "三级机构",
          CAST(policy_date AS DATE) AS "日期",
          
          -- 核心因子（与项目指标定义一致）
          COUNT(DISTINCT vin) AS auto_count,                                    -- 车险承保车辆数（车架号去重）
          COUNT(DISTINCT CASE WHEN is_cross_sell = true THEN vin END) AS driver_count,  -- 驾乘险承保车辆数（车架号去重）
          COUNT(DISTINCT CASE WHEN is_cross_sell = true THEN policy_no END) AS driver_policy_count,  -- 驾乘险保单件数
          SUM(CASE WHEN is_cross_sell = true THEN premium ELSE 0 END) AS driver_premium,  -- 驾乘险保费
          SUM(premium) AS auto_premium,                                          -- 车险保费
          
          -- 计算指标
          ROUND(
            COUNT(DISTINCT CASE WHEN is_cross_sell = true THEN vin END) * 100.0 / 
            NULLIF(COUNT(DISTINCT vin), 0), 
            2
          ) AS "推介率",
          
          ROUND(
            SUM(CASE WHEN is_cross_sell = true THEN premium ELSE 0 END) / 
            NULLIF(COUNT(DISTINCT CASE WHEN is_cross_sell = true THEN policy_no END), 0),
            2
          ) AS "驾乘险件均保费",
          
          ROUND(
            SUM(premium) / NULLIF(COUNT(DISTINCT vin), 0),
            2
          ) AS "车险件均保费"
          
        FROM read_parquet('${CONFIG.dataPath}')
        WHERE policy_date >= CURRENT_DATE - INTERVAL '${CONFIG.daysToAnalyze} days'
          AND policy_date < CURRENT_DATE
          AND is_quote = false          -- 排除报价记录
          AND coverage_type = '商业险'  -- 只筛选商业险
        GROUP BY org_level_3, CAST(policy_date AS DATE)
      )
      
      SELECT 
        "三级机构",
        "日期",
        auto_count,
        driver_count,
        driver_policy_count,
        driver_premium,
        auto_premium,
        "推介率",
        "驾乘险件均保费",
        "车险件均保费"
      FROM daily_stats
      ORDER BY "三级机构", "日期"
    `;
    
    db.all(sql, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

/**
 * 按机构组织数据（用于表格生成）
 */
function organizeByOrg(data) {
  const orgData = {};
  
  data.forEach(row => {
    const org = row['三级机构'];
    const date = row['日期'];
    
    if (!orgData[org]) {
      orgData[org] = {
        dates: [],
        推介率: {},
        驾乘险件均保费: {},
        driver_policy_count: {}
      };
    }
    
    if (!orgData[org].dates.includes(date)) {
      orgData[org].dates.push(date);
    }
    
    orgData[org].推介率[date] = row['推介率'] || 0;
    orgData[org].驾乘险件均保费[date] = row['驾乘险件均保费'] || 0;
    orgData[org].driver_policy_count[date] = row['driver_policy_count'] || 0;
  });
  
  // 排序日期
  Object.keys(orgData).forEach(org => {
    orgData[org].dates.sort();
  });
  
  return orgData;
}

/**
 * 生成分析结论
 */
function generateAnalysis(orgData) {
  const analyses = [];
  const orgs = Object.keys(orgData);
  
  // 1. 计算整体趋势
  let overallTrends = {
    avgRecommendRate: [],
    avgPremium: [],
    totalCount: []
  };
  
  // 获取最近7天和前7天的对比数据
  const allDates = new Set();
  orgs.forEach(org => {
    orgData[org].dates.forEach(d => allDates.add(d));
  });
  const sortedDates = Array.from(allDates).sort();
  
  if (sortedDates.length >= 7) {
    const last7Days = sortedDates.slice(-7);
    const prev7Days = sortedDates.slice(-14, -7);
    
    // 计算最近7天平均值
    let last7Avg = { rate: 0, premium: 0, count: 0 };
    let prev7Avg = { rate: 0, premium: 0, count: 0 };
    
    orgs.forEach(org => {
      last7Days.forEach(date => {
        if (orgData[org].推介率[date] !== undefined) {
          last7Avg.rate += orgData[org].推介率[date];
          last7Avg.premium += orgData[org].驾乘险件均保费[date];
          last7Avg.count += orgData[org].driver_policy_count[date];
        }
      });
      
      prev7Days.forEach(date => {
        if (orgData[org].推介率[date] !== undefined) {
          prev7Avg.rate += orgData[org].推介率[date];
          prev7Avg.premium += orgData[org].驾乘险件均保费[date];
          prev7Avg.count += orgData[org].driver_policy_count[date];
        }
      });
    });
    
    // 生成趋势分析
    const rateChange = (last7Avg.rate - prev7Avg.rate).toFixed(2);
    const premiumChange = (last7Avg.premium - prev7Avg.premium).toFixed(2);
    const countChange = last7Avg.count - prev7Avg.count;
    
    analyses.push({
      type: '整体趋势',
      content: `最近7天对比前7天：推介率${rateChange > 0 ? '上升' : '下降'} ${Math.abs(rateChange)}%，` +
               `驾乘险件均保费${premiumChange > 0 ? '上升' : '下降'} ${Math.abs(premiumChange)}元，` +
               `驾乘险件数${countChange > 0 ? '增加' : '减少'} ${Math.abs(countChange)}件`
    });
  }
  
  // 2. 识别问题机构（推介率低于平均水平）
  let avgRates = {};
  orgs.forEach(org => {
    const rates = Object.values(orgData[org].推介率);
    avgRates[org] = rates.reduce((a, b) => a + b, 0) / rates.length;
  });
  
  const overallAvg = Object.values(avgRates).reduce((a, b) => a + b, 0) / orgs.length;
  const problemOrgs = Object.entries(avgRates)
    .filter(([org, rate]) => rate < overallAvg * 0.8) // 低于平均80%
    .sort((a, b) => a[1] - b[1]);
  
  if (problemOrgs.length > 0) {
    analyses.push({
      type: '问题机构',
      content: `推介率偏低的机构：${problemOrgs.map(([org, rate]) => 
        `${org}(${rate.toFixed(2)}%)`
      ).join('、')}。建议重点关注培训与激励措施。`
    });
  }
  
  // 3. 识别优秀机构
  const topOrgs = Object.entries(avgRates)
    .filter(([org, rate]) => rate > overallAvg * 1.2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  
  if (topOrgs.length > 0) {
    analyses.push({
      type: '优秀机构',
      content: `推介率领先的机构：${topOrgs.map(([org, rate]) => 
        `${org}(${rate.toFixed(2)}%)`
      ).join('、')}。建议总结推广优秀经验。`
    });
  }
  
  return analyses;
}

/**
 * 生成 Markdown 表格
 */
function generateTable(title, orgData, metric, isPercent = false) {
  const orgs = Object.keys(orgData).sort();
  const allDates = new Set();
  
  orgs.forEach(org => {
    orgData[org].dates.forEach(d => allDates.add(d));
  });
  
  const sortedDates = Array.from(allDates).sort();
  
  // 表头
  let table = `### ${title}\n\n`;
  table += '| 三级机构 | ' + sortedDates.map(d => {
    const date = new Date(d);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }).join(' | ') + ' |\n';
  
  table += '|------' + '|------'.repeat(sortedDates.length) + '|\n';
  
  // 表体
  orgs.forEach(org => {
    table += `| ${org} |`;
    sortedDates.forEach(date => {
      const value = orgData[org][metric][date];
      if (value !== undefined) {
        if (isPercent) {
          table += ` ${value.toFixed(2)}% |`;
        } else if (metric === '驾乘险件均保费') {
          table += ` ${value.toFixed(0)} |`;
        } else {
          table += ` ${value} |`;
        }
      } else {
        table += ' - |';
      }
    });
    table += '\n';
  });
  
  return table;
}

/**
 * 生成 CSV 数据（用于数据分析）
 */
function generateCSV(data) {
  // CSV 表头
  let csv = '三级机构,日期,auto_count,driver_count,driver_policy_count,driver_premium,auto_premium,推介率,驾乘险件均保费,车险件均保费\n';
  
  // CSV 数据行
  data.forEach(row => {
    csv += `"${row['三级机构']}",${row['日期']},${row.auto_count},${row.driver_count},${row.driver_policy_count},${row.driver_premium},${row.auto_premium},${row['推介率']},${row['驾乘险件均保费']},${row['车险件均保费']}\n`;
  });
  
  return csv;
}

/**
 * 生成完整日报（Markdown）
 */
function generateReport(data, analyses, orgData) {
  const today = new Date();
  const dateStr = today.toLocaleDateString('zh-CN', { 
    year: 'numeric', 
    month: '2-digit', 
    day: '2-digit',
    timeZone: CONFIG.timezone
  });
  
  let report = `# 驾乘险推介率日报\n\n`;
  report += `**报告日期**: ${dateStr}\n`;
  report += `**分析周期**: 最近 ${CONFIG.daysToAnalyze} 天\n`;
  report += `**数据截止**: ${new Date().toISOString().split('T')[0]}\n`;
  report += `**筛选条件**: 险种大类 = 商业险\n\n`;
  
  report += `---\n\n`;
  
  // 一、结论先行
  report += `## 一、核心结论\n\n`;
  analyses.forEach((analysis, idx) => {
    report += `### ${idx + 1}. ${analysis.type}\n\n`;
    report += `${analysis.content}\n\n`;
  });
  
  // 二、分论点详解
  report += `## 二、详细分析\n\n`;
  
  // 2.1 驾乘险推介率
  report += `### 2.1 驾乘险推介率分析\n\n`;
  report += `驾乘险推介率反映了业务员向客户推荐驾乘险的积极性和能力。推介率越高，说明交叉销售工作越到位。\n\n`;
  report += `**关键指标**：\n`;
  report += `- 推介率 = driver_count / auto_count × 100%\n`;
  report += `- 目标：推介率应保持在 30% 以上\n`;
  report += `- 优秀机构：推介率 > 40%\n\n`;
  
  // 2.2 驾乘险件均保费
  report += `### 2.2 驾乘险件均保费分析\n\n`;
  report += `驾乘险件均保费反映了驾乘险保单的价值。件均保费高，说明业务员推荐的驾乘险保障更全面。\n\n`;
  report += `**关键指标**：\n`;
  report += `- 驾乘险件均保费 = driver_premium / driver_policy_count\n`;
  report += `- 基准：件均保费 > 200 元\n\n`;
  
  // 2.3 驾乘险件数
  report += `### 2.3 驾乘险件数分析\n\n`;
  report += `驾乘险件数直接反映了交叉销售的绝对成果。件数越多，说明驾乘险销售业绩越好。\n\n`;
  report += `**关键指标**：\n`;
  report += `- 驾乘险件数 = driver_policy_count\n`;
  report += `- 增长目标：环比增长 > 5%\n\n`;
  
  // 三、数据表格
  report += `## 三、详细数据表格\n\n`;
  
  report += generateTable('驾乘险推介率 (%)', orgData, '推介率', true);
  report += '\n\n';
  
  report += generateTable('驾乘险件均保费 (元)', orgData, '驾乘险件均保费');
  report += '\n\n';
  
  report += generateTable('驾乘险件数', orgData, 'driver_policy_count');
  report += '\n\n';
  
  report += `---\n\n`;
  report += `**报告生成时间**: ${new Date().toLocaleString('zh-CN', { timeZone: CONFIG.timezone })}\n`;
  report += `**数据来源**: 车险保单综合明细表（商业险）\n`;
  report += `**生成工具**: OpenClaw 自动化日报系统\n`;
  
  return report;
}

/**
 * 主函数
 */
async function main() {
  console.log('🚀 驾乘险推介率日报生成器启动...\n');
  
  try {
    // 1. 初始化数据库
    console.log('📊 初始化 DuckDB...');
    const db = await initDB();
    
    // 2. 查询数据
    console.log(`📈 查询最近${CONFIG.daysToAnalyze}天数据（商业险）...`);
    const data = await queryData(db);
    console.log(`   ✓ 查询到 ${data.length} 条记录`);
    
    if (data.length === 0) {
      console.error('❌ 未查询到数据，请检查数据源');
      process.exit(1);
    }
    
    // 3. 组织数据
    console.log('🔄 组织数据结构...');
    const orgData = organizeByOrg(data);
    console.log(`   ✓ ${Object.keys(orgData).length} 个三级机构`);
    
    // 4. 生成分析
    console.log('💡 生成分析结论...');
    const analyses = generateAnalysis(orgData);
    
    // 5. 生成报告
    console.log('📝 生成日报...');
    const report = generateReport(data, analyses, orgData);
    
    // 6. 生成 CSV 数据
    console.log('📊 生成 CSV 数据...');
    const csv = generateCSV(data);
    
    // 7. 保存文件
    const dateStr = new Date().toISOString().split('T')[0];
    const reportPath = path.join(CONFIG.outputPath, `驾乘险推介率日报_${dateStr}.md`);
    const csvPath = path.join(CONFIG.outputPath, `驾乘险推介率数据_${dateStr}.csv`);
    
    fs.mkdirSync(CONFIG.outputPath, { recursive: true });
    fs.writeFileSync(reportPath, report, 'utf-8');
    fs.writeFileSync(csvPath, csv, 'utf-8');
    
    console.log(`\n✅ 日报生成成功！`);
    console.log(`📄 Markdown: ${reportPath}`);
    console.log(`📊 CSV数据: ${csvPath}\n`);
    
    // 8. 输出到控制台
    console.log('='.repeat(80));
    console.log(report);
    console.log('='.repeat(80));
    
    // 9. 关闭数据库
    db.close();
    
    process.exit(0);
  } catch (error) {
    console.error('❌ 生成日报失败:', error);
    process.exit(1);
  }
}

// 执行主函数
main();
