/**
 * CSP 配置回归守护（B320）
 *
 * 守护：全局 helmet CSP 的 scriptSrc 永不含 'unsafe-eval'。
 * 两层断言：
 *  1) 对象层 —— cspDirectives 数据结构本身。
 *  2) 响应头层 —— 经真实 helmet 序列化后的 Content-Security-Policy 头
 *     （防 helmet 序列化差异 / 指令名大小写 / 被静默丢弃）。
 *
 * 背景：移除 'unsafe-eval' 恢复严格 XSS 防护。前端已无 DuckDB-WASM
 * （2026-02 起 API-only），源码零 eval()/new Function()，ECharts geo
 * 地图加载路径只传已解析对象、不触发 ECharts 的 new Function fallback。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, type Server } from 'http';
import express from 'express';
import helmet from 'helmet';
import { cspDirectives, helmetOptions } from '../csp.js';

describe('CSP 配置（B320 回归守护）', () => {
  describe('对象层', () => {
    it("scriptSrc 不含 'unsafe-eval'", () => {
      expect(cspDirectives.scriptSrc).not.toContain("'unsafe-eval'");
    });

    it("scriptSrc 含 'self'（白名单基线不被误删）", () => {
      expect(cspDirectives.scriptSrc).toContain("'self'");
    });

    it("defaultSrc 含 'self'", () => {
      expect(cspDirectives.defaultSrc).toContain("'self'");
    });

    it('保留既有受信来源（connectSrc 智谱/openrouter）', () => {
      expect(cspDirectives.connectSrc).toContain('https://open.bigmodel.cn');
      expect(cspDirectives.connectSrc).toContain('https://openrouter.ai');
    });
  });

  describe('响应头层（真实 helmet 序列化 + 共用 app.ts 的 helmetOptions）', () => {
    let server: Server;

    const startServer = (): Promise<number> =>
      new Promise((resolve) => {
        const app = express();
        // 直接复用 app.ts 接入 helmet 的同一对象，避免复刻配置造成假阳性
        app.use(helmet(helmetOptions));
        app.get('/health', (_req, res) => res.json({ ok: true }));
        server = createServer(app);
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          resolve(typeof addr === 'object' && addr ? addr.port : 0);
        });
      });

    afterAll(() => {
      server?.close();
    });

    it("Content-Security-Policy 头含 script-src 且不含 'unsafe-eval'", async () => {
      const port = await startServer();
      const resp = await fetch(`http://127.0.0.1:${port}/health`);
      const csp = resp.headers.get('content-security-policy') ?? '';

      expect(csp).toContain('script-src');
      expect(csp).not.toContain('unsafe-eval');
      // 仍保留 unsafe-inline（本 PR 范围控制，未顺手收紧）
      expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    });
  });
});
