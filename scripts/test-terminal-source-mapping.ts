/**
 * 测试 terminal_source 字段映射
 */

import { validateAndResolveMapping, COLUMN_ALIASES } from '../src/shared/normalize/mapping';

// 模拟实际 Parquet 文件的列名
const actualColumns = [
  '保单号',
  '续保单号',
  '业务员',
  '三级机构',
  '签单日期',
  '保险起期',
  '险类',
  '险别组合',
  '保费',
  '是否续保',
  '是否可续',
  '是否新车',
  '是否新能源',
  '是否过户车',
  '是否电销',
  '终端来源',  // 这是我们要测试的字段
  '客户类别',
  '厂牌车型',
  '吨位分段',
  '新车购置价',
  '批单号',
  '批改类型',
  '商车自主定价系数',
  '是否交商统保',
];

console.log('='.repeat(80));
console.log('测试 terminal_source 字段映射');
console.log('='.repeat(80));
console.log();

const result = validateAndResolveMapping(actualColumns, COLUMN_ALIASES);

console.log('验证结果:', result.valid ? '✅ 通过' : '❌ 失败');
console.log();

if (result.errors.length > 0) {
  console.log('错误:');
  result.errors.forEach(err => console.log('  ❌', err));
  console.log();
}

if (result.warnings.length > 0) {
  console.log('警告:');
  result.warnings.forEach(warn => console.log('  ⚠️ ', warn));
  console.log();
}

if (result.mapping) {
  console.log('字段映射:');
  console.log('-'.repeat(80));

  const mappingEntries = Object.entries(result.mapping).sort((a, b) => a[0].localeCompare(b[0]));

  for (const [domainField, actualColumn] of mappingEntries) {
    console.log(`  ${domainField.padEnd(25)} → ${actualColumn}`);
  }
  console.log();

  // 特别检查 terminal_source
  console.log('='.repeat(80));
  if (result.mapping.terminal_source) {
    console.log('✅ terminal_source 字段映射成功！');
    console.log(`   域字段: terminal_source`);
    console.log(`   实际列名: ${result.mapping.terminal_source}`);
  } else {
    console.log('❌ terminal_source 字段未映射');
  }
  console.log('='.repeat(80));
}
