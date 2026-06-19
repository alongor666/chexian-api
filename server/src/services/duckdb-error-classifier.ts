/**
 * DuckDB 原始报错 → 安全中文分类（白名单）
 *
 * 设计：.claude/plans/cx-cli-swift-pudding.md P0.5「错误透明化」。
 *
 * 背景：生产环境 duckdb.ts 把 DuckDB 原始报错压成 `查询执行失败 [uuid]`（防泄露），
 * 导致 cx sql 用户连「列名打错」「类型不匹配」都无法自助 debug——这是 cx-cli 五道结构墙
 * 之一「错误不透明」。本模块用白名单正则把原始报错归一为**固定中文分类**，生产环境叠加到
 * uuid 后回传。
 *
 * 安全不变量（RED LINE，勿删依赖）：
 *   ① 只回传**固定分类文案** + 从用户自己 SQL 中被引用的**schema 标识符**（关系名/列名）。
 *   ② **绝不**回传 DuckDB 原始消息整体、行数据值、完整 SQL、或 DuckDB 的 "Did you mean X?"
 *      / "Candidate bindings: ..." 建议片段（后者会泄露用户无权访问的内部关系/列名）。
 *   ③ 捕获组只取「用户引用的那个标识符」，不取建议项；类型/转换类错误可能含字面量值，
 *      因此**不抽取任何标识符**，只给纯分类。
 *   ④ 未命中白名单 → 返回 null（调用方退回纯 uuid，维持现状兜底，不泄露未知报错）。
 *
 * 标识符回传安全性：关系名是联邦白名单内的公开视图名；列名是用户在自己 SQL 里写的，
 * 回显只是确认其拼写，非数据泄露。仅取 `[A-Za-z0-9_]+` 且长度上限，防止把消息其余部分带出。
 */

/** 安全抽取一个 schema 标识符（关系/列名）：仅字母数字下划线、长度上限 64，否则丢弃 */
function safeIdent(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = /^[A-Za-z0-9_]{1,64}$/.exec(raw);
  return m ? raw : null;
}

/**
 * 把 DuckDB 原始报错归一为安全中文分类。命中返回分类文案，未命中返回 null。
 * @param rawMessage DuckDB 抛出的原始 error.message
 */
export function classifyDuckDbError(rawMessage: string): string | null {
  if (!rawMessage) return null;

  // 关系/视图不存在（Catalog Error）。只取用户引用的名字，不带 "Did you mean Y?" 建议。
  let m = /Catalog Error:[^]*?(?:Table|View) with name ([A-Za-z0-9_]+) does not exist/i.exec(rawMessage);
  if (m) {
    const id = safeIdent(m[1]);
    return id
      ? `关系/视图不存在：${id}（请确认视图名，或用 cx routes 查可用域）`
      : '关系/视图不存在（请确认视图名，或用 cx routes 查可用域）';
  }

  // 列不存在（Binder Error）。只取被引用列名，不带 "Candidate bindings: ..." 候选。
  m = /(?:Referenced column|Column)\s+"?([A-Za-z0-9_]+)"?\s+(?:not found|does not exist)/i.exec(rawMessage);
  if (m) {
    const id = safeIdent(m[1]);
    return id ? `列不存在：${id}（请核对列名拼写/大小写）` : '列不存在（请核对列名拼写/大小写）';
  }

  // 类型不匹配 / 转换错误：原始消息可能含字面量值 → 不抽取任何标识符，只给分类。
  if (/Conversion Error|Could not convert|Cannot compare values of type|Mismatch Type|No function matches|Binder Error: No function/i.test(rawMessage)) {
    return '类型不匹配：值或表达式与列类型不兼容（如对文本列做数值比较、日期字面量格式不符，可用 CAST 显式转换）';
  }

  // 聚合 / GROUP BY 错误。
  if (/must appear in the GROUP BY|aggregate function|GROUP BY clause|nested aggregate/i.test(rawMessage)) {
    return '聚合查询错误：非聚合列需出现在 GROUP BY，或聚合函数使用不当';
  }

  // 语法错误（Parser Error）：near 片段会带 SQL，故不回传片段，只给分类。
  if (/Parser Error|syntax error/i.test(rawMessage)) {
    return 'SQL 语法错误：请检查关键字 / 括号 / 引号配对';
  }

  // 除零（DuckDB 报为 "Out of Range Error: Division by zero!"，须先于 Out of Range 命中）。
  if (/Division by zero/i.test(rawMessage)) {
    return '除零错误：除数为 0（可用 NULLIF(分母, 0) 规避）';
  }

  // 数值范围 / 溢出。
  if (/Out of Range|Overflow|value out of range/i.test(rawMessage)) {
    return '数值超出范围或溢出';
  }

  return null;
}
