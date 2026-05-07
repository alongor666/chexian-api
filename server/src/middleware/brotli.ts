/**
 * Brotli 压缩中间件
 *
 * 客户端 Accept-Encoding 含 br 时，对 res.json 响应体用 zlib brotli 压缩。
 * 不支持 br 的客户端 next() 后由后续 compression() 中间件做 gzip。
 *
 * 选 quality=4 是体积/速度的折中（quality=11 是最高压缩比但 CPU 开销 100x+）。
 * 对 JSON 响应实测 brotli q4 比 gzip q6 体积小 15-25%、CPU 略低。
 */

import type { Request, Response, NextFunction } from 'express';
import { brotliCompressSync, constants } from 'zlib';
import { clientAcceptsBrotli } from '../utils/accept-encoding.js';

const THRESHOLD = 1024; // 字节，与 compression() 一致
const QUALITY = 4;

export function brotliMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!clientAcceptsBrotli(req.headers['accept-encoding'] as string | undefined)) {
      next();
      return;
    }

    const origJson = res.json.bind(res);
    res.json = function (body: any) {
      const json = JSON.stringify(body);
      const buf = Buffer.from(json, 'utf-8');
      if (buf.length < THRESHOLD) return origJson(body);

      try {
        const compressed = brotliCompressSync(buf, {
          params: {
            [constants.BROTLI_PARAM_QUALITY]: QUALITY,
            [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
          },
        });
        res.setHeader('Content-Encoding', 'br');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Length', String(compressed.length));
        // 累加 Vary 而非覆盖
        const existing = res.getHeader('Vary');
        const varies = new Set(
          (existing ? String(existing).split(/,\s*/) : []).concat('Accept-Encoding'),
        );
        res.setHeader('Vary', Array.from(varies).join(', '));
        return res.end(compressed);
      } catch {
        // 压缩失败 fallback 到默认 res.json，由 compression() gzip 兜底
        return origJson(body);
      }
    } as any;
    next();
  };
}
