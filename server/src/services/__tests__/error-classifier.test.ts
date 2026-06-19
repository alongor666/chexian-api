/**
 * DuckDB 错误分类器测试（P0.5 错误透明化）。
 *
 * 文件名刻意不带 duckdb- 前缀：被测模块是纯字符串正则、无 DuckDB 原生依赖，应在 CI 运行
 * （vite.config.ts 把 services/__tests__/duckdb-*.test.ts 排除在 CI 外，因其需 .node 原生二进制）。
 *
 * 核心验证：
 *   ① 各类 DuckDB 真实报错 → 命中正确中文分类。
 *   ② 安全不变量：分类文案绝不含原始消息整体 / "Did you mean" 建议 / "Candidate bindings" 候选 /
 *      数据字面量值（类型错误样本含 'abc' 值，断言不出现在输出里）。
 *   ③ 未知报错 → null（调用方退回纯 uuid）。
 */
import { describe, expect, it } from 'vitest';
import { classifyDuckDbError } from '../duckdb-error-classifier.js';

describe('classifyDuckDbError — 命中分类', () => {
  it('关系/视图不存在（Catalog Error）→ 抽取用户引用的视图名', () => {
    const out = classifyDuckDbError('Catalog Error: Table with name NewEnergyClaims does not exist!\nDid you mean "RepairDim"?');
    expect(out).toContain('关系/视图不存在');
    expect(out).toContain('NewEnergyClaims');
  });

  it('安全不变量：Catalog Error 不回传 "Did you mean" 建议（防泄露内部关系名）', () => {
    const out = classifyDuckDbError('Catalog Error: Table with name Foo does not exist!\nDid you mean "RepairDim"?');
    expect(out).not.toContain('RepairDim');
    expect(out).not.toContain('Did you mean');
  });

  it('列不存在（Binder Error）→ 抽取被引用列名，不回传 Candidate bindings', () => {
    const out = classifyDuckDbError('Binder Error: Referenced column "foo_typo" not found in FROM clause!\nCandidate bindings: "org_level_3", "premium"');
    expect(out).toContain('列不存在');
    expect(out).toContain('foo_typo');
    expect(out).not.toContain('org_level_3');
    expect(out).not.toContain('Candidate');
  });

  it('类型不匹配（Conversion Error）→ 分类文案，不回传数据字面量值', () => {
    const out = classifyDuckDbError("Conversion Error: Could not convert string 'abc' to INT32");
    expect(out).toContain('类型不匹配');
    expect(out).not.toContain('abc'); // 字面量值绝不外泄
  });

  it('聚合 / GROUP BY 错误 → 分类', () => {
    const out = classifyDuckDbError('Binder Error: column "org_level_3" must appear in the GROUP BY clause or be used in an aggregate function');
    expect(out).toContain('聚合查询错误');
  });

  it('语法错误（Parser Error）→ 分类，不回传 SQL 片段', () => {
    const out = classifyDuckDbError('Parser Error: syntax error at or near "SELCT"');
    expect(out).toContain('语法错误');
    expect(out).not.toContain('SELCT');
  });

  it('除零（Out of Range Error: Division by zero）→ 命中除零而非数值范围', () => {
    const out = classifyDuckDbError('Out of Range Error: Division by zero!');
    expect(out).toContain('除零');
  });

  it('数值溢出 → 数值超出范围', () => {
    const out = classifyDuckDbError('Out of Range Error: Overflow in multiplication of INT32');
    expect(out).toContain('数值超出范围');
  });
});

describe('classifyDuckDbError — 未命中与边界', () => {
  it('未知报错 → null（调用方退回纯 uuid）', () => {
    expect(classifyDuckDbError('Some totally unknown internal error xyz')).toBeNull();
  });

  it('空消息 → null', () => {
    expect(classifyDuckDbError('')).toBeNull();
  });

  it('超长/非法标识符不被抽取（防把消息其余部分带出）', () => {
    // 构造一个"列名"超过 64 字符的畸形消息：safeIdent 拒绝 → 退回无标识符的纯分类
    const longName = 'a'.repeat(80);
    const out = classifyDuckDbError(`Binder Error: Referenced column "${longName}" not found`);
    expect(out).toContain('列不存在');
    expect(out).not.toContain(longName);
  });
});
