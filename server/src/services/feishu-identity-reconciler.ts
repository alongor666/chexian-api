import { feishuService } from './feishu.js';
import { disableFeishuIdentity, listEnabledFeishuIdentities } from './auth-identity.js';

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;

export async function reconcileFeishuIdentitiesOnce(): Promise<{ checked: number; disabled: number; unavailable: number }> {
  const identities = await listEnabledFeishuIdentities();
  const result = { checked: 0, disabled: 0, unavailable: 0 };
  for (const identity of identities) {
    result.checked += 1;
    const resolution = await feishuService.resolveDepartmentEntitlement(identity.providerSubject);
    if (resolution.status === 'not_member') {
      await disableFeishuIdentity(identity.providerSubject);
      result.disabled += 1;
    } else if (resolution.status === 'unavailable') {
      result.unavailable += 1;
      console.warn(`[FeishuIdentityReconciler] identity=${identity.id} unavailable: ${resolution.reason}`);
    }
  }
  return result;
}

export function startFeishuIdentityReconciler(intervalMs = DEFAULT_INTERVAL_MS): void {
  if (timer) return;
  timer = setInterval(() => {
    void reconcileFeishuIdentitiesOnce().catch(error => {
      console.warn(`[FeishuIdentityReconciler] cycle failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, intervalMs);
  timer.unref();
}

export function stopFeishuIdentityReconciler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
