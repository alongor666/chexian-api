import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DASHBOARD_SECTION_META,
  DEFAULT_KPI_ORDER,
  DEFAULT_SECTION_ORDER,
  KPI_CARD_META,
  type DashboardSectionId,
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
  kpis: {
    order: KpiCardId[];
    visibility: LayoutVisibility<KpiCardId>;
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
  return [...filtered, ...missing];
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
    order: DEFAULT_KPI_ORDER,
    visibility: buildVisibility(DEFAULT_KPI_ORDER),
  },
};

const getInitialLayout = (): StoredLayout => {
  const parsed = getStorageJson<Partial<StoredLayout>>(STORAGE_KEY, {});
  if (!parsed.sections && !parsed.kpis) return defaultLayout;
  return {
    sections: {
      order: normalizeOrder(parsed.sections?.order, DEFAULT_SECTION_ORDER),
      visibility: normalizeVisibility(parsed.sections?.visibility, DEFAULT_SECTION_ORDER),
    },
    kpis: {
      order: normalizeOrder(parsed.kpis?.order, DEFAULT_KPI_ORDER),
      visibility: normalizeVisibility(parsed.kpis?.visibility, DEFAULT_KPI_ORDER),
    },
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

  const toggleKpi = useCallback((id: KpiCardId) => {
    setLayout((prev) => ({
      ...prev,
      kpis: {
        ...prev.kpis,
        visibility: {
          ...prev.kpis.visibility,
          [id]: !prev.kpis.visibility[id],
        },
      },
    }));
  }, []);

  const moveKpi = useCallback((id: KpiCardId, direction: 'up' | 'down') => {
    setLayout((prev) => ({
      ...prev,
      kpis: {
        ...prev.kpis,
        order: moveItem(prev.kpis.order, id, direction),
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

  const kpiItems = useMemo(
    () =>
      layout.kpis.order.map((id) => ({
        id,
        label: KPI_CARD_META.find((item) => item.id === id)?.label || id,
        visible: layout.kpis.visibility[id],
      })),
    [layout.kpis.order, layout.kpis.visibility]
  );

  return {
    sectionOrder: layout.sections.order,
    sectionVisibility: layout.sections.visibility,
    kpiOrder: layout.kpis.order,
    kpiVisibility: layout.kpis.visibility,
    sectionItems,
    kpiItems,
    toggleSection,
    moveSection,
    toggleKpi,
    moveKpi,
    resetLayout,
  };
};
