/**
 * 预警管理 Hook（API-only 模式）
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import type {
  AlertMessage,
  AlertRule,
  AlertSummary,
} from '../../../shared/types/alert';
import { DEFAULT_ALERT_RULES } from '../../../shared/types/alert';
import {
  runAlertChecks,
  calculateAlertSummary,
  createTargetProgress,
  type AlertCheckData,
} from '../../../shared/utils/alertChecker';
import { apiClient } from '../../../shared/api/client';
import { getStorageJson, setStorageJson, safeStorage } from '../../../shared/utils/storage';

import { Logger } from '@/shared/utils/logger';

const logger = new Logger('Alerts');

/** Hook 返回类型 */
export interface UseAlertsResult {
  alerts: AlertMessage[];
  summary: AlertSummary;
  loading: boolean;
  error: string | null;
  rules: AlertRule[];
  refreshAlerts: () => Promise<void>;
  markAsRead: (alertId: string) => void;
  markAllAsRead: () => void;
  markAsResolved: (alertId: string) => void;
  updateRule: (ruleId: string, updates: Partial<AlertRule>) => void;
  clearAlerts: () => void;
}

/** Hook 配置 */
export interface UseAlertsConfig {
  autoLoad?: boolean;
  customRules?: AlertRule[];
  annualTarget?: number;
  monthlyTarget?: number;
  filters?: {
    orgLevel3?: string[];
    startDate?: string;
    endDate?: string;
  };
}

const STORAGE_KEY_RULES = 'alert_rules';
const STORAGE_KEY_ALERTS = 'alert_messages';

function loadRulesFromStorage(): AlertRule[] {
  return getStorageJson<AlertRule[]>(STORAGE_KEY_RULES, DEFAULT_ALERT_RULES);
}

function saveRulesToStorage(rules: AlertRule[]): void {
  setStorageJson(STORAGE_KEY_RULES, rules);
}

function loadAlertsFromStorage(): AlertMessage[] {
  const alerts = getStorageJson<AlertMessage[]>(STORAGE_KEY_ALERTS, []);
  return alerts.map((a) => ({
    ...a,
    timestamp: new Date(a.timestamp),
  }));
}

function saveAlertsToStorage(alerts: AlertMessage[]): void {
  const toSave = alerts.slice(0, 100);
  setStorageJson(STORAGE_KEY_ALERTS, toSave);
}

/**
 * 预警管理 Hook
 */
export function useAlerts(config: UseAlertsConfig = {}): UseAlertsResult {
  const { autoLoad = true, customRules, annualTarget, monthlyTarget, filters } = config;

  const [alerts, setAlerts] = useState<AlertMessage[]>(() => loadAlertsFromStorage());
  const [rules, setRules] = useState<AlertRule[]>(() => customRules || loadRulesFromStorage());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const summary = useMemo(() => calculateAlertSummary(alerts), [alerts]);

  const fetchAlertData = useCallback(async (): Promise<AlertCheckData[]> => {
    const checkData: AlertCheckData[] = [];

    let whereClause = '1=1';
    if (filters?.orgLevel3 && filters.orgLevel3.length > 0) {
      const orgs = filters.orgLevel3.map(o => `'${o}'`).join(',');
      whereClause += ` AND org_level_3 IN (${orgs})`;
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const prevYear = currentYear - 1;

    try {
      const orgComparisonSql = `
        WITH current_data AS (
          SELECT
            org_level_3,
            SUM(premium) as current_premium,
            COUNT(DISTINCT policy_no) as current_count
          FROM PolicyFact
          WHERE EXTRACT(YEAR FROM sign_date) = ${currentYear}
            AND ${whereClause}
          GROUP BY org_level_3
        ),
        previous_data AS (
          SELECT
            org_level_3,
            SUM(premium) as previous_premium,
            COUNT(DISTINCT policy_no) as previous_count
          FROM PolicyFact
          WHERE EXTRACT(YEAR FROM sign_date) = ${prevYear}
            AND EXTRACT(MONTH FROM sign_date) <= ${currentMonth}
            AND ${whereClause}
          GROUP BY org_level_3
        )
        SELECT
          COALESCE(c.org_level_3, p.org_level_3) as dimension,
          COALESCE(c.current_premium, 0) as current_premium,
          COALESCE(p.previous_premium, 0) as previous_premium,
          COALESCE(c.current_count, 0) as current_count,
          COALESCE(p.previous_count, 0) as previous_count
        FROM current_data c
        FULL OUTER JOIN previous_data p ON c.org_level_3 = p.org_level_3
        WHERE COALESCE(c.current_premium, 0) > 0 OR COALESCE(p.previous_premium, 0) > 0
      `;

      const orgData = await apiClient.executeCustomQuery(orgComparisonSql);

      for (const row of orgData) {
        checkData.push({
          dimension: row.dimension as string,
          currentPremium: Number(row.current_premium) || 0,
          previousPremium: Number(row.previous_premium) || 0,
          currentCount: Number(row.current_count) || 0,
          previousCount: Number(row.previous_count) || 0,
        });
      }

      if (annualTarget || monthlyTarget) {
        const totalSql = `
          SELECT
            SUM(CASE WHEN EXTRACT(YEAR FROM sign_date) = ${currentYear} THEN premium ELSE 0 END) as ytd_premium,
            SUM(CASE WHEN EXTRACT(YEAR FROM sign_date) = ${currentYear} AND EXTRACT(MONTH FROM sign_date) = ${currentMonth} THEN premium ELSE 0 END) as mtd_premium
          FROM PolicyFact
          WHERE ${whereClause}
        `;

        const totalData = await apiClient.executeCustomQuery(totalSql);
        const totalRow = totalData[0];

        if (annualTarget && totalRow) {
          const ytdPremium = Number(totalRow.ytd_premium) || 0;
          const progress = createTargetProgress('annual', annualTarget, ytdPremium, '整体');
          checkData.push({ dimension: '整体', targetProgress: progress });
        }

        if (monthlyTarget && totalRow) {
          const mtdPremium = Number(totalRow.mtd_premium) || 0;
          const progress = createTargetProgress('monthly', monthlyTarget, mtdPremium, '整体');
          checkData.push({ dimension: '整体（月度）', targetProgress: progress });
        }
      }

      const avgSql = `
        SELECT
          org_level_3 as dimension,
          AVG(premium) as average_premium
        FROM PolicyFact
        WHERE EXTRACT(YEAR FROM sign_date) = ${currentYear}
          AND ${whereClause}
        GROUP BY org_level_3
      `;

      const avgData = await apiClient.executeCustomQuery(avgSql);

      for (const row of avgData) {
        const existing = checkData.find(d => d.dimension === row.dimension);
        if (existing) {
          existing.averagePremium = Number(row.average_premium) || 0;
        }
      }

    } catch (e) {
      logger.error('[useAlerts] 查询数据失败:', e);
      throw e;
    }

    return checkData;
  }, [filters, annualTarget, monthlyTarget]);

  const refreshAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const checkData = await fetchAlertData();
      const newAlerts = runAlertChecks(checkData, rules);

      setAlerts(prev => {
        const merged = [...newAlerts];

        for (const oldAlert of prev) {
          const matchingNew = merged.find(
            n => n.type === oldAlert.type && n.dimension === oldAlert.dimension
          );
          if (matchingNew) {
            matchingNew.read = matchingNew.read || oldAlert.read;
            matchingNew.resolved = matchingNew.resolved || oldAlert.resolved;
          }
        }

        saveAlertsToStorage(merged);
        return merged;
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : '预警检测失败';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [fetchAlertData, rules]);

  const markAsRead = useCallback((alertId: string) => {
    setAlerts(prev => {
      const updated = prev.map(a =>
        a.id === alertId ? { ...a, read: true } : a
      );
      saveAlertsToStorage(updated);
      return updated;
    });
  }, []);

  const markAllAsRead = useCallback(() => {
    setAlerts(prev => {
      const updated = prev.map(a => ({ ...a, read: true }));
      saveAlertsToStorage(updated);
      return updated;
    });
  }, []);

  const markAsResolved = useCallback((alertId: string) => {
    setAlerts(prev => {
      const updated = prev.map(a =>
        a.id === alertId ? { ...a, resolved: true, read: true } : a
      );
      saveAlertsToStorage(updated);
      return updated;
    });
  }, []);

  const updateRule = useCallback((ruleId: string, updates: Partial<AlertRule>) => {
    setRules(prev => {
      const updated = prev.map(r =>
        r.id === ruleId ? { ...r, ...updates } : r
      );
      saveRulesToStorage(updated);
      return updated;
    });
  }, []);

  const clearAlerts = useCallback(() => {
    setAlerts([]);
    safeStorage.removeItem(STORAGE_KEY_ALERTS);
  }, []);

  useEffect(() => {
    if (autoLoad) {
      refreshAlerts();
    }
  }, [autoLoad]);

  return {
    alerts,
    summary,
    loading,
    error,
    rules,
    refreshAlerts,
    markAsRead,
    markAllAsRead,
    markAsResolved,
    updateRule,
    clearAlerts,
  };
}
