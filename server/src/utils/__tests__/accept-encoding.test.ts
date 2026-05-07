import { describe, it, expect } from 'vitest';
import { clientAcceptsBrotli, clientAcceptsGzip } from '../accept-encoding.js';

describe('Accept-Encoding 协商', () => {
  it('br 出现且无 q → 接受', () => {
    expect(clientAcceptsBrotli('br')).toBe(true);
    expect(clientAcceptsBrotli('gzip, br')).toBe(true);
    expect(clientAcceptsBrotli('gzip, deflate, br')).toBe(true);
  });

  it('br;q=0 → 拒绝（即使列出）', () => {
    expect(clientAcceptsBrotli('br;q=0')).toBe(false);
    expect(clientAcceptsBrotli('gzip, br;q=0')).toBe(false);
    expect(clientAcceptsBrotli('gzip;q=1, br;q=0')).toBe(false);
  });

  it('br;q=0.5 → 接受（>0 即可）', () => {
    expect(clientAcceptsBrotli('br;q=0.5')).toBe(true);
    expect(clientAcceptsBrotli('br;q=0.001')).toBe(true);
  });

  it('未列出 br + 未列出 * → 拒绝', () => {
    expect(clientAcceptsBrotli('gzip')).toBe(false);
    expect(clientAcceptsBrotli('identity')).toBe(false);
  });

  it('* 通配符控制 br', () => {
    expect(clientAcceptsBrotli('*;q=1')).toBe(true);
    expect(clientAcceptsBrotli('*;q=0')).toBe(false);
    // 显式声明优先于通配符
    expect(clientAcceptsBrotli('br;q=1, *;q=0')).toBe(true);
    expect(clientAcceptsBrotli('br;q=0, *;q=1')).toBe(false);
  });

  it('空/缺失头 → 拒绝 br', () => {
    expect(clientAcceptsBrotli('')).toBe(false);
    expect(clientAcceptsBrotli(undefined)).toBe(false);
    expect(clientAcceptsBrotli(null)).toBe(false);
  });

  it('大小写不敏感', () => {
    expect(clientAcceptsBrotli('BR')).toBe(true);
    expect(clientAcceptsBrotli('Br;Q=0')).toBe(false);
  });

  it('clientAcceptsGzip 同样正确处理 q=0', () => {
    expect(clientAcceptsGzip('gzip, br')).toBe(true);
    expect(clientAcceptsGzip('gzip;q=0, br')).toBe(false);
    expect(clientAcceptsGzip('br')).toBe(false);
  });
});
