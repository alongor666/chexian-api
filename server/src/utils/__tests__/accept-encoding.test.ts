import { describe, it, expect } from 'vitest';
import {
  clientAcceptsBrotli,
  clientAcceptsGzip,
  selectBestEncoding,
} from '../accept-encoding.js';

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

  describe('selectBestEncoding (q-value 偏好)', () => {
    it('q-value 严格更高的胜出（修 Codex P2）', () => {
      // 客户端明确偏好 gzip：q=1 > br q=0.1
      expect(selectBestEncoding('gzip;q=1, br;q=0.1', ['br', 'gzip'])).toBe('gzip');
      // 反向：br q=1 > gzip q=0.5 → br
      expect(selectBestEncoding('br;q=1, gzip;q=0.5', ['br', 'gzip'])).toBe('br');
    });

    it('q-value 相等时按 candidates 顺序 tie-break', () => {
      // candidates ['br','gzip']：两者 q=1 → br 先
      expect(selectBestEncoding('br, gzip', ['br', 'gzip'])).toBe('br');
      expect(selectBestEncoding('gzip, br', ['br', 'gzip'])).toBe('br');
      // 反转候选顺序：gzip 先
      expect(selectBestEncoding('br, gzip', ['gzip', 'br'])).toBe('gzip');
    });

    it('q=0 的候选不参与', () => {
      expect(selectBestEncoding('br;q=0, gzip', ['br', 'gzip'])).toBe('gzip');
      expect(selectBestEncoding('br, gzip;q=0', ['br', 'gzip'])).toBe('br');
    });

    it('全部不接受时返回 null', () => {
      expect(selectBestEncoding('br;q=0, gzip;q=0', ['br', 'gzip'])).toBeNull();
      expect(selectBestEncoding('identity', ['br', 'gzip'])).toBeNull();
      expect(selectBestEncoding('', ['br', 'gzip'])).toBeNull();
      expect(selectBestEncoding(undefined, ['br', 'gzip'])).toBeNull();
    });

    it('* 通配符让所有候选都接受（tie-break 走候选顺序）', () => {
      expect(selectBestEncoding('*;q=1', ['br', 'gzip'])).toBe('br');
      expect(selectBestEncoding('*;q=0', ['br', 'gzip'])).toBeNull();
      // 显式 q 覆盖通配
      expect(selectBestEncoding('*;q=1, br;q=0.2', ['br', 'gzip'])).toBe('gzip');
    });

    it('空 candidates 返回 null', () => {
      expect(selectBestEncoding('br, gzip', [])).toBeNull();
    });
  });
});
