/**
 * 内容安全策略（CSP）配置
 * Content Security Policy Configuration
 *
 * 全局 helmet CSP 指令的唯一事实源。从 app.ts 抽出（镜像 config/cors.ts 模式），
 * 便于单测回归守护与复用。
 *
 * 安全决策（B320 · 2026-06-22）：scriptSrc 移除 'unsafe-eval'，恢复严格 XSS 防护。
 *  - 前端已无 DuckDB-WASM（2026-02 起 API-only，见 src/shared/INDEX.md）
 *  - src/ 全量零 eval()/new Function()
 *  - ECharts geo 地图加载路径（src/shared/utils/geo-map-loader.ts）只把已解析对象
 *    传给 registerMap，不触发 ECharts 内部 GeoJSON 字符串解码的 new Function fallback
 *
 * 保留 'unsafe-inline'：本 PR 范围控制，不顺手扩大策略变更。Express 全局 CSP 当前
 * 唯一 HTML 响应是报告（/api/reports 自设 REPORT_HTML_CSP 覆盖全局），其余为
 * JSON/health/error，保留 'unsafe-inline' 无功能影响。收紧 inline 的真正影响面是
 * Nginx 托管的 SPA（当前无 CSP），需 nonce/hash 策略，属独立后续任务。
 *
 * 注意：本指令仅覆盖 Express 服务的响应；生产 SPA 由 Nginx 托管，其 CSP 另在
 * deploy/nginx-*.conf 维护（当前未设）。
 */
import type { HelmetOptions } from 'helmet';

type CspOptions = Exclude<NonNullable<HelmetOptions['contentSecurityPolicy']>, boolean>;
type CspDirectives = NonNullable<CspOptions['directives']>;

export const cspDirectives: CspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "'unsafe-inline'"], // 'unsafe-eval' 已移除（B320）
  styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  fontSrc: ["'self'", "https://fonts.gstatic.com"],
  imgSrc: ["'self'", "data:", "blob:"],
  connectSrc: ["'self'", "https://open.bigmodel.cn", "https://openrouter.ai"],
};

/**
 * 完整 helmet 选项 —— app.ts 与单测共用此唯一对象（避免测试复刻配置造成假阳性：
 * 若误把 'unsafe-eval' 加回或改回内联，回归守护测试能直接命中真实生效配置）。
 */
export const helmetOptions: HelmetOptions = {
  contentSecurityPolicy: { directives: cspDirectives },
  crossOriginEmbedderPolicy: false,
};
