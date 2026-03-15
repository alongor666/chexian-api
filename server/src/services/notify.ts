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

const WEBHOOK_URL = process.env.UNMATCHED_NOTIFY_WEBHOOK || '';

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
