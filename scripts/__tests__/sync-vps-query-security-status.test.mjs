/**
 * parseSecurityStatusResponse() 直接单测（scripts/sync-vps.mjs）
 *
 * 背景：PR #1014 对抗性评审（2026-07-09）指出——真正做"curl stdout → JSON 解析 →
 * fail-closed 判定"的逻辑原先内联在 queryVpsSecurityStatus() 里，被 SSH 网络调用包裹，
 * 从未有测试直接执行过这段判定本体；既有的 sync-vps-sx-auto-promote.test.mjs 只测了
 * 更上层的 runSxAutoPromote()，靠依赖注入 mock 掉了整个 queryRls，这层"真正做判断"的
 * 代码完全没有测试拦截回归（例如误把严格类型检查 `typeof x !== 'boolean'` 改成宽松的
 * `!x`/`?? null` 这类看似等价、实则会漏判字符串 "true" 或把 false 误当失败的改动）。
 *
 * 修复方式：把解析判定逻辑抽成纯函数 parseSecurityStatusResponse(stdout)（不碰网络/SSH），
 * 本文件直接调用它，覆盖评审指出的全部边界，无需 mock child_process。
 */
import { describe, it, expect } from 'vitest';
import { parseSecurityStatusResponse } from '../sync-vps.mjs';

describe('parseSecurityStatusResponse', () => {
  it('branchRlsEnabled: true → 返回 true', () => {
    const stdout = JSON.stringify({ success: true, data: { security: { branchRlsEnabled: true } } });
    expect(parseSecurityStatusResponse(stdout)).toBe(true);
  });

  it('branchRlsEnabled: false（真实核实为关闭）→ 返回 false，不是 null', () => {
    const stdout = JSON.stringify({ success: true, data: { security: { branchRlsEnabled: false } } });
    expect(parseSecurityStatusResponse(stdout)).toBe(false);
  });

  it('success: false → 返回 null（fail-closed）', () => {
    const stdout = JSON.stringify({ success: false, error: 'internal error' });
    expect(parseSecurityStatusResponse(stdout)).toBeNull();
  });

  it('data.security.branchRlsEnabled 字段缺失 → 返回 null（fail-closed）', () => {
    const stdout = JSON.stringify({ success: true, data: { policy: { maxDate: '2026-07-08' } } });
    expect(parseSecurityStatusResponse(stdout)).toBeNull();
  });

  it('data.security 对象整体缺失 → 返回 null（fail-closed）', () => {
    const stdout = JSON.stringify({ success: true, data: {} });
    expect(parseSecurityStatusResponse(stdout)).toBeNull();
  });

  it('branchRlsEnabled 是字符串 "true"（非布尔）→ 返回 null（严格类型检查拦截）', () => {
    const stdout = JSON.stringify({ success: true, data: { security: { branchRlsEnabled: 'true' } } });
    expect(parseSecurityStatusResponse(stdout)).toBeNull();
  });

  it('branchRlsEnabled 是数字 1（非布尔）→ 返回 null（严格类型检查拦截）', () => {
    const stdout = JSON.stringify({ success: true, data: { security: { branchRlsEnabled: 1 } } });
    expect(parseSecurityStatusResponse(stdout)).toBeNull();
  });

  it('stdout 非 JSON（如端点未部署返回 404 HTML）→ 返回 null（fail-closed）', () => {
    expect(parseSecurityStatusResponse('<html><body>404 Not Found</body></html>')).toBeNull();
  });

  it('stdout 为空字符串（curl 静默失败）→ 返回 null（fail-closed）', () => {
    expect(parseSecurityStatusResponse('')).toBeNull();
  });

  it('stdout 为 undefined/null（execRemote 异常路径）→ 返回 null（fail-closed）', () => {
    expect(parseSecurityStatusResponse(undefined)).toBeNull();
    expect(parseSecurityStatusResponse(null)).toBeNull();
  });

  it('stdout 带首尾空白（真实 curl 输出常见换行）→ 仍正确解析', () => {
    const stdout = `\n  ${JSON.stringify({ success: true, data: { security: { branchRlsEnabled: true } } })}  \n`;
    expect(parseSecurityStatusResponse(stdout)).toBe(true);
  });
});
