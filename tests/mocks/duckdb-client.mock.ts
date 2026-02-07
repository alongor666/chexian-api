/**
 * DuckDB Client Mock for Testing
 * 
 * 为测试环境提供DuckDB客户端的Mock实现
 * 解决Web Worker依赖问题，使测试能在Node.js环境运行
 */

import { DateMetadata, DualDateMetadata } from '../../src/shared/types/data';

/**
 * Mock DuckDB Client
 * 模拟真实DuckDB客户端行为，提供相同的API接口
 */
class MockDuckDBClient {
  private isInitialized = false;
  private dataLoaded = false;

  /**
   * 模拟初始化
   */
  async init(): Promise<void> {
    // 模拟异步初始化
    await new Promise(resolve => setTimeout(resolve, 10));
    this.isInitialized = true;
  }

  /**
   * 模拟数据加载
   */
  async loadParquet(file: File | string): Promise<any> {
    if (!this.isInitialized) await this.init();
    
    // 模拟数据加载过程
    await new Promise(resolve => setTimeout(resolve, 50));
    this.dataLoaded = true;
    
    // 返回模拟的列映射
    return {
      policy_no: 'policy_no',
      premium: 'premium',
      policy_date: 'policy_date',
      insurance_start_date: 'insurance_start_date',
      salesman_name: 'salesman_name',
      org_level_3: 'org_level_3',
      customer_category: 'customer_category',
      insurance_type: 'insurance_type',
      coverage_combination: 'coverage_combination',
      is_renewal: 'is_renewal',
      is_new_car: 'is_new_car',
      is_transfer: 'is_transfer',
      is_nev: 'is_nev',
      is_telemarketing: 'is_telemarketing',
    };
  }

  /**
   * 检查数据是否已加载
   */
  isDataLoaded(): boolean {
    return this.dataLoaded;
  }

  /**
   * 模拟查询执行
   */
  query(sql: string): { promise: Promise<any>; requestId: string; batchId: string } {
    const requestId = `mock_req_${Date.now()}_${Math.random()}`;
    const batchId = `mock_batch_${Date.now()}`;

    const promise = new Promise((resolve) => {
      // 模拟异步查询执行
      setTimeout(() => {
        resolve(this.createMockQueryResult(sql));
      }, 20);
    });

    return { promise, requestId, batchId };
  }

  /**
   * 根据SQL创建模拟查询结果
   */
  private createMockQueryResult(sql: string) {
    // 模拟数据表结构
    const mockData = {
      toArray: () => {
        if (sql.includes('max_date')) {
          return [{ max_date: '2026-12-15' }];
        }
        if (sql.includes('YEAR') && sql.includes('DISTINCT')) {
          return [
            { year: 2026 },
            { year: 2025 },
            { year: 2024 },
            { year: 2023 }
          ];
        }
        return [];
      }
    };

    return mockData;
  }

  /**
   * 开始新的查询批次
   */
  startBatch(): string {
    return `mock_batch_${Date.now()}_${Math.random()}`;
  }

  /**
   * 检查批次是否有效
   */
  isBatchValid(batchId: string): boolean {
    // Mock实现总是返回true
    return true;
  }

  /**
   * 检查请求是否最新
   */
  isLatestRequest(requestId: string): boolean {
    // Mock实现总是返回true
    return true;
  }

  /**
   * 获取指定日期字段的元数据
   */
  async getDateMetadata(dateField: string): Promise<DateMetadata> {
    if (!this.dataLoaded) {
      throw new Error('数据未加载，请先调用loadParquet()');
    }

    // 模拟不同日期字段的元数据
    const mockMetadata: Record<string, DateMetadata> = {
      'policy_date': {
        maxDate: '2026-12-15',
        availableYears: [2026, 2025, 2024, 2023]
      },
      'insurance_start_date': {
        maxDate: '2027-03-20',
        availableYears: [2027, 2026, 2025, 2024, 2023]
      }
    };

    return mockMetadata[dateField] || mockMetadata['policy_date'];
  }

  /**
   * 获取双口径元数据
   */
  async getDualDateMetadata(): Promise<DualDateMetadata> {
    const [policyMetadata, insuranceMetadata] = await Promise.all([
      this.getDateMetadata('policy_date'),
      this.getDateMetadata('insurance_start_date')
    ]);

    return {
      policy: policyMetadata,
      insurance: insuranceMetadata
    };
  }
}

// 导出Mock实例
export const mockDuckDBClient = new MockDuckDBClient();