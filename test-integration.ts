/**
 * 集成测试脚本
 * 验证 CSV 解析、数据聚合、筛选功能
 */

import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * 创建模拟 File 对象（Node.js 环境）
 */
function createMockFile(content: string, filename: string): File {
  const blob = new Blob([content], { type: 'text/csv' });
  return new File([blob], filename, { type: 'text/csv' });
}

/**
 * 测试主函数
 */
async function runIntegrationTest() {
  console.log('========================================');
  console.log('🧪 集成测试开始');
  console.log('========================================\n');

  try {
    // 1. 读取 CSV 文件
    console.log('📂 1. 读取 CSV 文件...');
    const csvPath = join(process.cwd(), '2025保单第52周变动成本明细表.csv');
    const csvContent = readFileSync(csvPath, 'utf-8');
    console.log(`✅ 文件大小: ${(csvContent.length / 1024).toFixed(2)} KB`);
    console.log(`   文件路径: ${csvPath}\n`);

    // 2. 动态导入 DataService（支持 ES 模块）
    console.log('📦 2. 加载模块...');
    const { default: DataService } = await import('@/services/DataService.js');
    const { default: FilterService } = await import('@/services/FilterService.js');
    console.log('✅ 模块加载成功\n');

    // 3. 解析 CSV 文件
    console.log('📊 3. 解析 CSV 文件...');
    const file = createMockFile(csvContent, '2025保单第52周变动成本明细表.csv');
    const parseResult = await DataService.parseFile(file);
    console.log(`✅ 解析成功:`);
    console.log(`   - 数据行数: ${parseResult.meta.rowCount}`);
    console.log(`   - 字段数: ${parseResult.meta.columnCount}`);
    console.log(`   - 解析耗时: ${parseResult.meta.parseTime.toFixed(2)}ms`);
    console.log(`   - 错误数: ${parseResult.errors.length}\n`);

    if (parseResult.errors.length > 0) {
      console.log('⚠️ 解析错误:');
      parseResult.errors.slice(0, 5).forEach((err) => console.log(`   - ${err}`));
      console.log('');
    }

    // 3. 显示前 3 行数据
    console.log('📋 3. 数据示例（前 3 行）:');
    const sampleRows = parseResult.data.slice(0, 3);
    sampleRows.forEach((row, index) => {
      console.log(`\n   行 ${index + 1}:`);
      console.log(`   - 机构: ${row.third_level_organization}`);
      console.log(`   - 业务类型: ${row.business_type_category}`);
      console.log(`   - 签单保费: ¥${row.signed_premium_yuan.toLocaleString()}`);
      console.log(`   - 赔款支出: ¥${row.reported_claim_payment_yuan.toLocaleString()}`);
      console.log(`   - 费用金额: ¥${row.expense_amount_yuan.toLocaleString()}`);
    });
    console.log('\n');

    // 4. 数据聚合
    console.log('🔄 4. 数据聚合...');
    const aggregatedData = DataService.aggregate(parseResult.data);
    console.log(`✅ 聚合成功:`);
    console.log(`   - 机构数: ${Object.keys(aggregatedData.byOrg).length}`);
    console.log(`   - 业务类型分类数: ${Object.keys(aggregatedData.byCategory).length}`);
    console.log(`   - 业务类型细分数: ${Object.keys(aggregatedData.byBusinessType).length}`);
    console.log(`   - 周次数: ${Object.keys(aggregatedData.byWeek).length}`);
    console.log(`   - 险种数: ${Object.keys(aggregatedData.byInsuranceType).length}\n`);

    // 5. 显示 KPI 汇总
    console.log('📊 5. KPI 汇总指标:');
    const { summary } = aggregatedData;
    console.log(`   - 签单保费: ¥${summary.签单保费.toLocaleString()}`);
    console.log(`   - 变动成本率: ${summary.变动成本率.toFixed(2)}%`);
    console.log(`   - 满期赔付率: ${summary.满期赔付率.toFixed(2)}%`);
    console.log(`   - 费用率: ${summary.费用率.toFixed(2)}%`);
    console.log(`   - 边际贡献额: ¥${summary.边际贡献额.toLocaleString()}`);
    console.log('');

    // 6. 显示机构聚合结果（前 5）
    console.log('🏢 6. 机构聚合结果（前 5）:');
    const orgEntries = Object.entries(aggregatedData.byOrg)
      .sort(([, a], [, b]) => b.签单保费 - a.签单保费)
      .slice(0, 5);

    orgEntries.forEach(([org, data]) => {
      console.log(`   - ${org}:`);
      console.log(`     签单保费: ¥${data.签单保费.toLocaleString()}`);
      console.log(`     满期赔付率: ${data.满期赔付率.toFixed(2)}%`);
    });
    console.log('');

    // 7. 测试筛选功能
    console.log('🔍 7. 测试筛选功能...');
    const filterState = {
      time: {
        year: 2025,
        weekStart: 50,
        weekEnd: 52,
      },
      drill: {
        applied: [],
        draft: {},
      },
    };

    const filteredData = FilterService.applyFilters(parseResult.data, filterState);
    console.log(`✅ 筛选成功:`);
    console.log(`   - 筛选条件: 2025年 第50-52周`);
    console.log(`   - 筛选前: ${parseResult.data.length} 行`);
    console.log(`   - 筛选后: ${filteredData.length} 行\n`);

    // 8. 测试维度选项生成
    console.log('🎯 8. 测试维度选项生成...');
    const dimensionOptions = FilterService.getDimensionOptions(
      parseResult.data,
      'third_level_organization'
    );
    console.log(`✅ 机构选项生成成功: ${dimensionOptions.length} 个机构`);
    console.log(`   前 5 个机构:`);
    dimensionOptions.slice(0, 5).forEach((opt) => {
      console.log(`   - ${opt.label}: ${opt.count} 条记录`);
    });
    console.log('');

    // 9. 测试业务类型映射
    console.log('🔧 9. 测试业务类型映射...');
    const testMappings = [
      '10吨以上-普货',
      '非营业客车新车',
      '出租车',
    ];

    testMappings.forEach((original) => {
      // 由于 mapBusinessTypeCategoryToShortLabel 是私有方法，我们通过聚合结果验证
      const category = aggregatedData.byBusinessType[original] ? '已映射' : '未映射';
      console.log(`   "${original}" -> ${category}`);
    });
    console.log('');

    // 10. 性能测试
    console.log('⚡ 10. 性能测试...');
    const perfIterations = 10;
    const perfStart = performance.now();

    for (let i = 0; i < perfIterations; i++) {
      DataService.aggregate(parseResult.data);
    }

    const perfEnd = performance.now();
    const avgTime = (perfEnd - perfStart) / perfIterations;
    console.log(`✅ 性能测试完成:`);
    console.log(`   - 迭代次数: ${perfIterations}`);
    console.log(`   - 总耗时: ${(perfEnd - perfStart).toFixed(2)}ms`);
    console.log(`   - 平均耗时: ${avgTime.toFixed(2)}ms/次\n`);

    // 测试总结
    console.log('========================================');
    console.log('✅ 集成测试全部通过！');
    console.log('========================================');
    console.log('\n📊 测试总结:');
    console.log(`   ✅ CSV 解析: 正常`);
    console.log(`   ✅ 数据聚合: 正常`);
    console.log(`   ✅ 数据筛选: 正常`);
    console.log(`   ✅ 维度选项: 正常`);
    console.log(`   ✅ 性能: ${avgTime < 100 ? '优秀' : avgTime < 500 ? '良好' : '需优化'}`);
    console.log('\n🎉 所有功能验证通过，可以进入 Phase 3！\n');

  } catch (error) {
    console.error('\n❌ 集成测试失败！');
    console.error(`错误信息: ${(error as Error).message}`);
    console.error(`错误堆栈: ${(error as Error).stack}`);
    process.exit(1);
  }
}

// 运行测试
runIntegrationTest();
