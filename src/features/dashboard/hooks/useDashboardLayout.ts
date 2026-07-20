import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DASHBOARD_SECTION_META,
  DEFAULT_KPI_ORDER,
  DEFAULT_SECTION_ORDER,
  KPI_CARD_META,
  type DashboardSectionId,
  type KpiGroup,
  type KpiCardId,
} from '../dashboardLayoutConfig';
import { getStorageJson, setStorageJson } from '../../../shared/utils/storage';

const STORAGE_KEY = 'dashboard_layout_v1';

type LayoutVisibility<T extends string> = Record<T, boolean>;

interface StoredLayout {
  sections: {
    order: DashboardSectionId[];
    visibility: LayoutVisibility<DashboardSectionId>;
  };
  kpis: Record<
    KpiGroup,
    {
      order: KpiCardId[];
      visibility: LayoutVisibility<KpiCardId>;
    }
  >;
}

interface LegacyStoredLayout {
  sections?: {
    order?: DashboardSectionId[];
    visibility?: Partial<LayoutVisibility<DashboardSectionId>>;
  };
  kpis?: {
    order?: KpiCardId[];
    visibility?: Partial<LayoutVisibility<KpiCardId>>;
  };
}

const buildVisibility = <T extends string>(ids: T[]): LayoutVisibility<T> =>
  ids.reduce((acc, id) => {
    acc[id] = true;
    return acc;
  }, {} as LayoutVisibility<T>);

const normalizeOrder = <T extends string>(stored: T[] | undefined, defaults: T[]): T[] => {
  if (!stored || stored.length === 0) return defaults;
  const filtered = stored.filter((id) => defaults.includes(id));
  const missing = defaults.filter((id) => !filtered.includes(id));
  const result = [...filtered];

  // 新增 KPI 要按默认相邻位置插入已有用户的自定义顺序；若一律 append，
  // “满期保费/满期率”会落到核心指标末尾，无法保持产品要求的卡片顺序。
  missing.forEach((id) => {
    const defaultIndex = defaults.indexOf(id);
    const nextId = defaults.slice(defaultIndex + 1).find((candidate) => result.includes(candidate));
    if (nextId) {
      result.splice(result.indexOf(nextId), 0, id);
      return;
    }
    const previousId = defaults
      .slice(0, defaultIndex)
      .reverse()
      .find((candidate) => result.includes(candidate));
    const insertAt = previousId ? result.indexOf(previousId) + 1 : result.length;
    result.splice(insertAt, 0, id);
  });
  return result;
};

const normalizeVisibility = <T extends string>(
  stored: Partial<LayoutVisibility<T>> | undefined,
  defaults: T[]
): LayoutVisibility<T> => {
  const result = {} as LayoutVisibility<T>;
  defaults.forEach((id) => {
    result[id] = stored?.[id] ?? true;
  });
  return result;
};

const defaultLayout: StoredLayout = {
  sections: {
    order: DEFAULT_SECTION_ORDER,
    visibility: buildVisibility(DEFAULT_SECTION_ORDER),
  },
  kpis: {
    core: {
      order: DEFAULT_KPI_ORDER.core,
      visibility: buildVisibility(DEFAULT_KPI_ORDER.core),
    },
    focus: {
      order: DEFAULT_KPI_ORDER.focus,
      visibility: buildVisibility(DEFAULT_KPI_ORDER.focus),
    },
  },
};

const KPI_GROUPS: KpiGroup[] = ['core', 'focus'];

const resolveKpiGroup = (id: KpiCardId): KpiGroup =>
  KPI_CARD_META.find((item) => item.id === id)?.group ?? 'focus';

const normalizeKpiGroupLayout = (
  parsed: Partial<StoredLayout> | LegacyStoredLayout
): StoredLayout['kpis'] => {
  // 兼容旧结构：kpis.order + kpis.visibility
  if (parsed.kpis && !('core' in parsed.kpis) && !('focus' in parsed.kpis)) {
    const legacy = parsed as LegacyStoredLayout;
    const legacyOrder = legacy.kpis?.order ?? [];
    const legacyVisibility = legacy.kpis?.visibility ?? {};

    const groupedOrder: Record<KpiGroup, KpiCardId[]> = { core: [], focus: [] };
    legacyOrder.forEach((id) => {
      const group = resolveKpiGroup(id);
      if (!groupedOrder[group].includes(id)) {
        groupedOrder[group].push(id);
      }
    });

    KPI_GROUPS.forEach((group) => {
      DEFAULT_KPI_ORDER[group].forEach((id) => {
        if (!groupedOrder[group].includes(id)) {
          groupedOrder[group].push(id);
        }
      });
    });

    return {
      core: {
        order: normalizeOrder(groupedOrder.core, DEFAULT_KPI_ORDER.core),
        visibility: normalizeVisibility(legacyVisibility, DEFAULT_KPI_ORDER.core),
      },
      focus: {
        order: normalizeOrder(groupedOrder.focus, DEFAULT_KPI_ORDER.focus),
        visibility: normalizeVisibility(legacyVisibility, DEFAULT_KPI_ORDER.focus),
      },
    };
  }

  const next = (parsed as Partial<StoredLayout>).kpis;
  return {
    core: {
      order: normalizeOrder(next?.core?.order, DEFAULT_KPI_ORDER.core),
      visibility: normalizeVisibility(next?.core?.visibility, DEFAULT_KPI_ORDER.core),
    },
    focus: {
      order: normalizeOrder(next?.focus?.order, DEFAULT_KPI_ORDER.focus),
      visibility: normalizeVisibility(next?.focus?.visibility, DEFAULT_KPI_ORDER.focus),
    },
  };
};

const getInitialLayout = (): StoredLayout => {
  const parsed = getStorageJson<Partial<StoredLayout> | LegacyStoredLayout>(STORAGE_KEY, {});
  if (!parsed.sections && !parsed.kpis) return defaultLayout;
  return {
    sections: {
      order: normalizeOrder(parsed.sections?.order, DEFAULT_SECTION_ORDER),
      visibility: normalizeVisibility(parsed.sections?.visibility, DEFAULT_SECTION_ORDER),
    },
    kpis: normalizeKpiGroupLayout(parsed),
  };
};

const moveItem = <T extends string>(order: T[], id: T, direction: 'up' | 'down'): T[] => {
  const index = order.indexOf(id);
  if (index < 0) return order;
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= order.length) return order;
  const next = [...order];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
};

export const useDashboardLayout = () => {
  const [layout, setLayout] = useState<StoredLayout>(getInitialLayout);

  // 持久化到安全存储
  useEffect(() => {
    setStorageJson(STORAGE_KEY, layout);
  }, [layout]);

  const toggleSection = useCallback((id: DashboardSectionId) => {
    setLayout((prev) => ({
      ...prev,
      sections: {
        ...prev.sections,
        visibility: {
          ...prev.sections.visibility,
          [id]: !prev.sections.visibility[id],
        },
      },
    }));
  }, []);

  const moveSection = useCallback((id: DashboardSectionId, direction: 'up' | 'down') => {
    setLayout((prev) => ({
      ...prev,
      sections: {
        ...prev.sections,
        order: moveItem(prev.sections.order, id, direction),
      },
    }));
  }, []);

  const toggleKpi = useCallback((group: KpiGroup, id: KpiCardId) => {
    setLayout((prev) => ({
      ...prev,
      kpis: {
        ...prev.kpis,
        [group]: {
          ...prev.kpis[group],
          visibility: {
            ...prev.kpis[group].visibility,
            [id]: !prev.kpis[group].visibility[id],
          },
        },
      },
    }));
  }, []);

  const moveKpi = useCallback((group: KpiGroup, id: KpiCardId, direction: 'up' | 'down') => {
    setLayout((prev) => ({
      ...prev,
      kpis: {
        ...prev.kpis,
        [group]: {
          ...prev.kpis[group],
          order: moveItem(prev.kpis[group].order, id, direction),
        },
      },
    }));
  }, []);

  const resetLayout = useCallback(() => {
    setLayout(defaultLayout);
  }, []);

  const sectionItems = useMemo(
    () =>
      layout.sections.order.map((id) => ({
        id,
        label: DASHBOARD_SECTION_META.find((item) => item.id === id)?.label || id,
        visible: layout.sections.visibility[id],
      })),
    [layout.sections.order, layout.sections.visibility]
  );

  const kpiItemsByGroup = useMemo(
    () => ({
      core: layout.kpis.core.order.map((id) => ({
        id,
        label: KPI_CARD_META.find((item) => item.id === id)?.label || id,
        visible: layout.kpis.core.visibility[id],
      })),
      focus: layout.kpis.focus.order.map((id) => ({
        id,
        label: KPI_CARD_META.find((item) => item.id === id)?.label || id,
        visible: layout.kpis.focus.visibility[id],
      })),
    }),
    [
      layout.kpis.core.order,
      layout.kpis.core.visibility,
      layout.kpis.focus.order,
      layout.kpis.focus.visibility,
    ]
  );

  return {
    sectionOrder: layout.sections.order,
    sectionVisibility: layout.sections.visibility,
    kpiOrderByGroup: {
      core: layout.kpis.core.order,
      focus: layout.kpis.focus.order,
    },
    kpiVisibilityByGroup: {
      core: layout.kpis.core.visibility,
      focus: layout.kpis.focus.visibility,
    },
    sectionItems,
    kpiItemsByGroup,
    toggleSection,
    moveSection,
    toggleKpi,
    moveKpi,
    resetLayout,
  };
};
