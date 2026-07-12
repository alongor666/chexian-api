/**
 * 未匹配需求通知服务
 *
 * 当用户意图无法匹配到已有能力时，通过飞书 Webhook 通知开发者，
 * 便于持续完善平台能力。
 *
 * 配置方式（在服务器 .env 中设置）：
 *   UNMATCHED_NOTIFY_WEBHOOK=https://open.feishu.cn/open-apis/bot/v2/hook/xxx
 */

import { safeLog } from '../utils/security.js';
import { aiEnv, authEnv, feishuEnv } from '../config/env.js';

const WEBHOOK_URL = aiEnv.UNMATCHED_NOTIFY_WEBHOOK;

export interface UnmatchedNotifyPayload {
  /** 用户原始输入 */
  userMessage: string;
  /** AI 的 suggestion 字段（AI 对需求的理解） */
  aiSuggestion?: string;
  /** 操作人用户名（来自 JWT） */
  username?: string;
}

/**
 * 发送未匹配需求通知
 *
 * 静默失败：如果 webhook 未配置或调用失败，记录日志后继续，不阻塞响应。
 */
export async function notifyUnmatchedIntent(payload: UnmatchedNotifyPayload): Promise<void> {
  if (!WEBHOOK_URL) return;

  const { userMessage, aiSuggestion, username } = payload;
  const ts = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  const content = [
    `🔍 **用户需求未匹配** — ${ts}`,
    `**操作人**：${username || '未知'}`,
    `**用户输入**：${userMessage}`,
    aiSuggestion ? `**AI 理解**：${aiSuggestion}` : null,
    `**建议**：评估是否需要新增对应分析能力`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const resp = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_type: 'text',
        content: { text: content.replace(/\*\*/g, '') },
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      safeLog('warn', 'notify', `Unmatched notify webhook returned ${resp.status}`);
    }
  } catch (err) {
    safeLog('warn', 'notify', `Unmatched notify webhook failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─────────────────────────────────────────────────────────────
// 密码事件通知（全员密码闭环 · 阶段二）
// ─────────────────────────────────────────────────────────────

/**
 * 密码变更方式（通知文案用中文标签，四类事件用户拍板）：
 *   activation = 激活令牌激活 / self_change = 自助改密 /
 *   feishu_reset = 飞书扫码找回 / admin_reset = 管理员重置
 */
export type PasswordEventMethod = 'activation' | 'self_change' | 'feishu_reset' | 'admin_reset';

const PASSWORD_METHOD_LABELS: Record<PasswordEventMethod, string> = {
  activation: '激活令牌激活',
  self_change: '自助改密',
  feishu_reset: '飞书扫码找回',
  admin_reset: '管理员重置',
};

const FEISHU_TENANT_TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const FEISHU_SEND_MESSAGE_URL = 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id';
/** tenant_access_token 提前刷新窗口：过期前 5 分钟即视为失效 */
const TOKEN_REFRESH_AHEAD_MS = 5 * 60 * 1000;

/** 进程内 tenant_access_token 缓存（按 appId 区分，防将来换专用通知应用时串 token） */
const tenantTokenCache = new Map<string, { token: string; expiresAt: number }>();

/** 仅供单测清缓存，业务代码禁止调用 */
export function __resetTenantTokenCacheForTest(): void {
  tenantTokenCache.clear();
}

/**
 * 获取飞书 tenant_access_token（进程内缓存至过期前 5 分钟）。
 * 失败抛错，由调用方按通知失败静默处理；错误信息不含 app_secret / token。
 */
async function getTenantAccessToken(appId: string, appSecret: string): Promise<string> {
  const cached = tenantTokenCache.get(appId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const resp = await fetch(FEISHU_TENANT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) {
    throw new Error(`tenant_access_token HTTP ${resp.status}`);
  }
  const data = await resp.json() as { code?: number; msg?: string; tenant_access_token?: string; expire?: number };
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`tenant_access_token code=${data.code} msg=${data.msg ?? ''}`);
  }

  const expireSeconds = typeof data.expire === 'number' && data.expire > 0 ? data.expire : 0;
  tenantTokenCache.set(appId, {
    token: data.tenant_access_token,
    expiresAt: Date.now() + expireSeconds * 1000 - TOKEN_REFRESH_AHEAD_MS,
  });
  return data.tenant_access_token;
}

/** 飞书应用 API 直发群消息（以应用身份，receive_id_type=chat_id） */
async function sendChatMessageViaApp(chatId: string, text: string): Promise<void> {
  const appId = authEnv.PASSWORD_NOTIFY_APP_ID || feishuEnv.FEISHU_APP_ID;
  const appSecret = authEnv.PASSWORD_NOTIFY_APP_SECRET || feishuEnv.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    safeLog('warn', 'notify', 'Password event chat notify skipped: Feishu app credentials missing');
    return;
  }

  const token = await getTenantAccessToken(appId, appSecret);
  const resp = await fetch(FEISHU_SEND_MESSAGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) {
    throw new Error(`im/v1/messages HTTP ${resp.status}`);
  }
  const data = await resp.json() as { code?: number; msg?: string };
  if (data.code !== 0) {
    throw new Error(`im/v1/messages code=${data.code} msg=${data.msg ?? ''}`);
  }
}

/**
 * 密码事件群播通知，双通道选择（主路径通知：纯登录飞书应用无 bot 能力、旧桥接应用禁放开可用范围，
 * 故不做 bot 私信，群播 + 审计留痕即闭环）：
 *   1. PASSWORD_EVENT_NOTIFY_WEBHOOK 非空 → 自定义机器人 webhook（旧通道，修补不拆除）
 *   2. 否则 PASSWORD_EVENT_NOTIFY_CHAT_ID 非空 → 飞书应用 API 直发群（新通道，飞书已下线自定义机器人入口）
 *   3. 两者皆空 → 跳过
 *
 * 静默失败：通道未配置或调用失败，记录 warn 日志后返回，绝不阻塞设密/改密主流程
 * （审计事件由调用方独立落盘，不依赖本通知成功）。
 * ⚠️ 本函数只收 username 与方式，令牌明文/密码明文禁止传入；app_secret/token 禁止打进日志。
 */
export async function notifyPasswordEvent(payload: {
  username: string;
  method: PasswordEventMethod;
}): Promise<void> {
  const webhookUrl = authEnv.PASSWORD_EVENT_NOTIFY_WEBHOOK;
  const chatId = authEnv.PASSWORD_EVENT_NOTIFY_CHAT_ID;
  if (!webhookUrl && !chatId) return;

  const ts = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const label = PASSWORD_METHOD_LABELS[payload.method];
  const content = `账号 ${payload.username} 的密码于 ${ts}（北京时间）通过「${label}」方式变更，非本人操作请联系管理员`;

  try {
    if (webhookUrl) {
      const resp = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msg_type: 'text',
          content: { text: content },
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (!resp.ok) {
        safeLog('warn', 'notify', `Password event webhook returned ${resp.status}`);
      }
      return;
    }

    await sendChatMessageViaApp(chatId, content);
  } catch (err) {
    safeLog('warn', 'notify', `Password event notify failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
