/**
 * 增量导入工具
 *
 * 检测数据变更，支持增量合并而非全量替换
 */

import { createLogger } from '../utils/logger';
import type {
  DataChange,
  DataChangeType,
  DataSnapshot,
  IncrementalLoadConfig,
  IncrementalLoadResult,
  IncrementalLoadState,
} from '../types/incremental';
import { DataChangeType as DataChangeTypeEnum } from '../types/incremental';

const logger = createLogger('IncrementalLoader');

/**
 * 增量加载器类
 */
export class IncrementalLoader {
  private config: Required<IncrementalLoadConfig>;
  private state: IncrementalLoadState;
  private currentData: Map<string, Record<string, any>> = new Map();

  constructor(config: IncrementalLoadConfig) {
    this.config = {
      primaryKeyField: config.primaryKeyField,
      compareFields: config.compareFields ?? [],
      batchSize: config.batchSize ?? 1000,
      enableDeduplication: config.enableDeduplication ?? true,
      changeThreshold: config.changeThreshold ?? 0,
    };

    this.state = {
      version: 0,
      lastLoadTime: 0,
      totalRecords: 0,
      lastSnapshot: this.createEmptySnapshot(),
      hasPendingChanges: false,
    };

    logger.info('IncrementalLoader initialized', {
      primaryKeyField: this.config.primaryKeyField,
      compareFields: this.config.compareFields,
    });
  }

  /**
   * 加载新数据（增量或全量）
   */
  async loadData(newData: Record<string, any>[]): Promise<IncrementalLoadResult> {
    const startTime = performance.now();
    const changes: DataChange[] = [];

    try {
      logger.info('Loading data', { rowCount: newData.length });

      // 首次加载：全量加载
      if (this.currentData.size === 0) {
        return this.fullReplace(newData, startTime);
      }

      // 检测变更
      const detectedChanges = this.detectChanges(newData);
      changes.push(...detectedChanges);

      // 应用变更
      this.applyChanges(changes);

      // 更新状态
      this.state.version++;
      this.state.lastLoadTime = Date.now();
      this.state.totalRecords = this.currentData.size;
      this.state.lastSnapshot = this.createSnapshot();
      this.state.hasPendingChanges = false;

      const duration = performance.now() - startTime;

      const result: IncrementalLoadResult = {
        success: true,
        changes,
        insertCount: changes.filter(c => c.type === DataChangeTypeEnum.INSERT).length,
        updateCount: changes.filter(c => c.type === DataChangeTypeEnum.UPDATE).length,
        deleteCount: changes.filter(c => c.type === DataChangeTypeEnum.DELETE).length,
        replaceCount: changes.filter(c => c.type === DataChangeTypeEnum.REPLACE).length,
        duration,
      };

      logger.info('Data loaded successfully', {
        insertCount: result.insertCount,
        updateCount: result.updateCount,
        deleteCount: result.deleteCount,
        duration: `${duration.toFixed(2)}ms`,
        totalRecords: this.state.totalRecords,
      });

      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to load data', { error: errorMessage, duration });

      return {
        success: false,
        changes: [],
        insertCount: 0,
        updateCount: 0,
        deleteCount: 0,
        replaceCount: 0,
        duration,
        error: errorMessage,
      };
    }
  }

  /**
   * 全量替换数据
   */
  private fullReplace(
    newData: Record<string, any>[],
    startTime: number
  ): IncrementalLoadResult {
    const oldData = Array.from(this.currentData.values());
    this.currentData.clear();

    const changes: DataChange[] = newData.map(row => ({
      type: DataChangeTypeEnum.INSERT as DataChangeType,
      primaryKey: String(row[this.config.primaryKeyField]),
      newData: row,
      timestamp: Date.now(),
    }));

    newData.forEach(row => {
      const pk = String(row[this.config.primaryKeyField]);
      this.currentData.set(pk, row);
    });

    this.state.version = 1;
    this.state.lastLoadTime = Date.now();
    this.state.totalRecords = this.currentData.size;
    this.state.lastSnapshot = this.createSnapshot();

    const duration = performance.now() - startTime;

    logger.info('Full replace completed', {
      recordCount: newData.length,
      duration: `${duration.toFixed(2)}ms`,
    });

    return {
      success: true,
      changes,
      insertCount: newData.length,
      updateCount: 0,
      deleteCount: oldData.length,
      replaceCount: newData.length,
      duration,
    };
  }

  /**
   * 检测数据变更
   */
  private detectChanges(newData: Record<string, any>[]): DataChange[] {
    const changes: DataChange[] = [];
    const newPrimaryKeySet = new Set<string>();
    const timestamp = Date.now();

    // 构建新数据主键集合
    newData.forEach(row => {
      const pk = String(row[this.config.primaryKeyField]);
      if (this.config.enableDeduplication) {
        if (newPrimaryKeySet.has(pk)) {
          logger.warn('Duplicate primary key detected', { pk });
        }
        newPrimaryKeySet.add(pk);
      }
    });

    // 检测新增和更新
    newData.forEach(newRow => {
      const pk = String(newRow[this.config.primaryKeyField]);
      const oldRow = this.currentData.get(pk);

      if (!oldRow) {
        // 新增
        changes.push({
          type: DataChangeTypeEnum.INSERT,
          primaryKey: pk,
          newData: newRow,
          timestamp,
        });
      } else if (this.hasChanged(oldRow, newRow)) {
        // 更新
        changes.push({
          type: DataChangeTypeEnum.UPDATE,
          primaryKey: pk,
          oldData: oldRow,
          newData: newRow,
          timestamp,
        });
      }
    });

    // 检测删除
    this.currentData.forEach((oldRow, pk) => {
      if (!newPrimaryKeySet.has(pk)) {
        changes.push({
          type: DataChangeTypeEnum.DELETE,
          primaryKey: pk,
          oldData: oldRow,
          timestamp,
        });
      }
    });

    logger.info('Changes detected', {
      insertCount: changes.filter(c => c.type === DataChangeTypeEnum.INSERT).length,
      updateCount: changes.filter(c => c.type === DataChangeTypeEnum.UPDATE).length,
      deleteCount: changes.filter(c => c.type === DataChangeTypeEnum.DELETE).length,
    });

    return changes;
  }

  /**
   * 判断数据是否变更
   */
  private hasChanged(oldRow: Record<string, any>, newRow: Record<string, any>): boolean {
    // 如果没有指定比较字段，比较所有字段
    const fieldsToCompare =
      this.config.compareFields.length > 0
        ? this.config.compareFields
        : Object.keys({ ...oldRow, ...newRow });

    for (const field of fieldsToCompare) {
      const oldValue = oldRow[field];
      const newValue = newRow[field];

      if (oldValue !== newValue) {
        // 如果是数字类型，检查是否超过阈值
        if (
          typeof oldValue === 'number' &&
          typeof newValue === 'number' &&
          this.config.changeThreshold > 0
        ) {
          if (Math.abs(newValue - oldValue) > this.config.changeThreshold) {
            return true;
          }
        } else {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 应用变更到当前数据
   */
  private applyChanges(changes: DataChange[]): void {
    changes.forEach(change => {
      const pk = change.primaryKey;

      switch (change.type) {
        case 'INSERT':
        case 'UPDATE':
          if (change.newData) {
            this.currentData.set(pk, change.newData);
          }
          break;

        case 'DELETE':
          this.currentData.delete(pk);
          break;
      }
    });
  }

  /**
   * 创建数据快照
   */
  private createSnapshot(): DataSnapshot {
    const primaryKeys = new Set(this.currentData.keys());

    return {
      timestamp: Date.now(),
      rowCount: this.currentData.size,
      primaryKeys,
      hash: this.calculateHash(),
    };
  }

  /**
   * 创建空快照
   */
  private createEmptySnapshot(): DataSnapshot {
    return {
      timestamp: 0,
      rowCount: 0,
      primaryKeys: new Set(),
      hash: '',
    };
  }

  /**
   * 计算数据哈希（用于快速比较）
   */
  private calculateHash(): string {
    // 简单哈希：基于主键集合和总记录数
    const keys = Array.from(this.currentData.keys()).sort();
    const sampleSize = Math.min(100, keys.length);
    const sampleKeys = keys.slice(0, sampleSize);

    return `${this.currentData.size}-${sampleKeys.join(',')}`;
  }

  /**
   * 获取当前数据
   */
  getData(): Record<string, any>[] {
    return Array.from(this.currentData.values());
  }

  /**
   * 获取当前状态
   */
  getState(): IncrementalLoadState {
    return { ...this.state };
  }

  /**
   * 清空所有数据
   */
  clear(): void {
    this.currentData.clear();
    this.state = {
      version: 0,
      lastLoadTime: 0,
      totalRecords: 0,
      lastSnapshot: this.createEmptySnapshot(),
      hasPendingChanges: false,
    };

    logger.info('Data cleared');
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      version: this.state.version,
      totalRecords: this.state.totalRecords,
      lastLoadTime: new Date(this.state.lastLoadTime).toISOString(),
      snapshot: {
        rowCount: this.state.lastSnapshot.rowCount,
        timestamp: new Date(this.state.lastSnapshot.timestamp).toISOString(),
      },
    };
  }
}

/**
 * 工具函数：检测两个数据集的差异
 */
export function detectDataDifferences(
  oldData: Record<string, any>[],
  newData: Record<string, any>[],
  primaryKeyField: string
): {
    onlyInOld: Record<string, any>[];
    onlyInNew: Record<string, any>[];
    inBoth: { old: Record<string, any>; new: Record<string, any> }[];
  } {
  const oldMap = new Map<string, Record<string, any>>();
  const newMap = new Map<string, Record<string, any>>();

  oldData.forEach(row => {
    const pk = String(row[primaryKeyField]);
    oldMap.set(pk, row);
  });

  newData.forEach(row => {
    const pk = String(row[primaryKeyField]);
    newMap.set(pk, row);
  });

  const onlyInOld: Record<string, any>[] = [];
  const onlyInNew: Record<string, any>[] = [];
  const inBoth: { old: Record<string, any>; new: Record<string, any> }[] = [];

  oldMap.forEach((row, pk) => {
    if (!newMap.has(pk)) {
      onlyInOld.push(row);
    }
  });

  newMap.forEach((row, pk) => {
    const oldRow = oldMap.get(pk);
    if (oldRow) {
      inBoth.push({ old: oldRow, new: row });
    } else {
      onlyInNew.push(row);
    }
  });

  return { onlyInOld, onlyInNew, inBoth };
}
