import React, { useCallback, useEffect, useState } from 'react';
import { apiClient, ApiTokenInfo, CreatedToken } from '../../shared/api/client';
import { Button, Card, FormItem, Input, Select, ConfirmDialog, useConfirmDialog } from '../../shared/ui';
import { colorClasses } from '../../shared/styles';

type TtlChoice = 30 | 90 | 180 | 365;

const TTL_OPTIONS: { value: string; label: string }[] = [
  { value: '30', label: '30 天' },
  { value: '90', label: '90 天（推荐）' },
  { value: '180', label: '180 天' },
  { value: '365', label: '365 天' },
];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

function maskTokenId(id: string): string {
  if (id.length <= 6) return id;
  return `${id.slice(0, 4)}…${id.slice(-2)}`;
}

function isExpired(t: ApiTokenInfo): boolean {
  if (t.revokedAt) return true;
  return new Date(t.expiresAt).getTime() < Date.now();
}

export const ApiTokensPanel: React.FC = () => {
  const [tokens, setTokens] = useState<ApiTokenInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createName, setCreateName] = useState('');
  const [createTtl, setCreateTtl] = useState<string>('90');
  const [creating, setCreating] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<CreatedToken | null>(null);

  const revokeConfirm = useConfirmDialog();
  const [pendingRevoke, setPendingRevoke] = useState<ApiTokenInfo | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await apiClient.auth.listMyTokens();
      setTokens(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 Token 列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = useCallback(async () => {
    if (!createName.trim()) {
      setError('请填写 Token 名称');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const result = await apiClient.auth.createMyToken({
        name: createName.trim(),
        ttlDays: Number(createTtl) as TtlChoice,
      });
      setCreatedSecret(result);
      setCreateName('');
      setCreateTtl('90');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建 Token 失败');
    } finally {
      setCreating(false);
    }
  }, [createName, createTtl, load]);

  const askRevoke = useCallback((t: ApiTokenInfo) => {
    setPendingRevoke(t);
    revokeConfirm.show();
  }, [revokeConfirm]);

  const handleRevoke = useCallback(async () => {
    if (!pendingRevoke) return;
    revokeConfirm.hide();
    try {
      await apiClient.auth.revokeMyToken(pendingRevoke.tokenId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '吊销失败');
    } finally {
      setPendingRevoke(null);
    }
  }, [pendingRevoke, revokeConfirm, load]);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 剪贴板失败不影响主流程，用户可手动复制
    }
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <div className="p-4 space-y-3">
          <h3 className="text-lg font-semibold">生成新 API Token</h3>
          <p className={`text-sm ${colorClasses.text.neutralMuted}`}>
            API Token 用于 CLI / MCP / Python 等程序化访问。<strong>强制只读</strong>，权限继承当前账号。
            生成后<strong className={colorClasses.text.danger}>仅显示一次</strong>，请立即保存。
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <FormItem label="Token 名称">
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="如：claude-desktop-mac / cron-daily-export"
                maxLength={64}
              />
            </FormItem>
            <FormItem label="有效期">
              <Select
                value={createTtl}
                onChange={(e) => setCreateTtl(e.target.value)}
                options={TTL_OPTIONS}
              />
            </FormItem>
            <div className="flex items-end">
              <Button onClick={handleCreate} disabled={creating || !createName.trim()}>
                {creating ? '生成中…' : '生成 Token'}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {error && (
        <Card>
          <div className={`p-3 ${colorClasses.text.danger}`}>✘ {error}</div>
        </Card>
      )}

      {createdSecret && (
        <Card>
          <div className="p-4 space-y-3">
            <h4 className={`text-md font-semibold ${colorClasses.text.dangerDark}`}>
              ⚠ 请立即保存以下 Token（关闭后无法再次查看）
            </h4>
            <pre className="p-3 bg-neutral-100 dark:bg-neutral-800 rounded text-sm break-all whitespace-pre-wrap font-mono">
              {createdSecret.token}
            </pre>
            <div className="flex gap-2">
              <Button onClick={() => copyToClipboard(createdSecret.token)}>复制到剪贴板</Button>
              <Button onClick={() => setCreatedSecret(null)} variant="secondary">我已保存，关闭</Button>
            </div>
            <p className={`text-xs ${colorClasses.text.neutralMuted}`}>
              tokenId: {createdSecret.tokenId} · 过期: {fmtDate(createdSecret.expiresAt)}
            </p>
          </div>
        </Card>
      )}

      <Card>
        <div className="p-4">
          <h3 className="text-lg font-semibold mb-3">我的 Token 列表</h3>
          {loading ? (
            <div className={colorClasses.text.neutralMuted}>加载中…</div>
          ) : tokens.length === 0 ? (
            <div className={colorClasses.text.neutralMuted}>尚未生成任何 Token</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 dark:border-neutral-700 text-left">
                    <th className="py-2 pr-4">名称</th>
                    <th className="py-2 pr-4">tokenId</th>
                    <th className="py-2 pr-4">创建时间</th>
                    <th className="py-2 pr-4">过期时间</th>
                    <th className="py-2 pr-4">最后使用</th>
                    <th className="py-2 pr-4">状态</th>
                    <th className="py-2 pr-4">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((t) => {
                    const expired = isExpired(t);
                    return (
                      <tr key={t.tokenId} className="border-b border-neutral-100 dark:border-neutral-800">
                        <td className="py-2 pr-4">{t.name}</td>
                        <td className="py-2 pr-4 font-mono text-xs">{maskTokenId(t.tokenId)}</td>
                        <td className="py-2 pr-4">{fmtDate(t.createdAt)}</td>
                        <td className="py-2 pr-4">{fmtDate(t.expiresAt)}</td>
                        <td className="py-2 pr-4">{fmtDate(t.lastUsedAt)}</td>
                        <td className="py-2 pr-4">
                          {t.revokedAt ? (
                            <span className={colorClasses.text.danger}>已吊销</span>
                          ) : expired ? (
                            <span className={colorClasses.text.danger}>已过期</span>
                          ) : (
                            <span className={colorClasses.text.positive}>有效</span>
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          {!t.revokedAt && !expired && (
                            <Button size="small" variant="danger" onClick={() => askRevoke(t)}>
                              吊销
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={revokeConfirm.open}
        title="吊销 Token"
        description={`确定吊销 "${pendingRevoke?.name}" ？此操作无法撤销，所有使用该 Token 的客户端将立即失效。`}
        confirmText="吊销"
        cancelText="取消"
        danger
        onConfirm={handleRevoke}
        onClose={() => { revokeConfirm.hide(); setPendingRevoke(null); }}
      />
    </div>
  );
};
