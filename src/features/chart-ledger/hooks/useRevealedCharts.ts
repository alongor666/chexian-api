/**
 * 图表账本 · 视口懒触发门控
 *
 * 观察各图卡外壳（DOM id = 'chart-01'…）是否进入视口（含 rootMargin 预取余量），
 * 进入即「永久」标记为 revealed，用于把整页 9 路查询从「挂载即全量并发」改为
 * 「按图渐进触发」——首屏只打首屏可见图所需的查询，滚动到才补取后半段。
 *
 * 降级：无 IntersectionObserver（jsdom 单测 / SSR / 老环境）时直接把全部 id 标为
 * revealed，回退到原有「全量并发」行为，保证既有测试与兼容性不受影响。
 *
 * 卡片外壳恒渲染（loading/error/empty 骨架也在），故观察目标始终存在，不存在
 * 「查询未触发 → 卡片不渲染 → 永远观察不到」的死锁。
 */
import { useEffect, useState } from 'react';

const supportsObserver = (): boolean =>
  typeof window !== 'undefined' && typeof window.IntersectionObserver !== 'undefined';

export function useRevealedCharts(ids: readonly string[], rootMargin = '600px 0px'): ReadonlySet<string> {
  const key = ids.join(',');
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() =>
    supportsObserver() ? new Set<string>() : new Set(ids)
  );

  useEffect(() => {
    if (!supportsObserver()) {
      setRevealed(new Set(ids));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const hits = entries.filter((e) => e.isIntersecting && e.target.id);
        if (hits.length === 0) return;
        setRevealed((prev) => {
          let changed = false;
          const next = new Set(prev);
          for (const e of hits) {
            if (!next.has(e.target.id)) {
              next.add(e.target.id);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
        // 已进入视口的元素无需继续观察
        for (const e of hits) observer.unobserve(e.target);
      },
      { rootMargin }
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
    // key 是 ids 的稳定化派生；ids 为模块级常量，二者同步变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rootMargin]);

  return revealed;
}
