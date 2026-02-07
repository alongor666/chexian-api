import { describe, it, expect } from 'vitest';
import { buildWhereClauseFromFilters } from '../src/shared/utils/queryBuilder';
import type { AdvancedFilterState } from '../src/features/filters/AdvancedFilterPanel';

describe('buildWhereClauseFromFilters', () => {
  it('should handle insurance_type=true (交强险)', () => {
    const filters: AdvancedFilterState = {
      insurance_type: true,
    };

    const result = buildWhereClauseFromFilters(filters);

    expect(result).toContain("insurance_type = '交强险'");
  });

  it('should handle insurance_type=false (商业保险)', () => {
    const filters: AdvancedFilterState = {
      insurance_type: false,
    };

    const result = buildWhereClauseFromFilters(filters);

    expect(result).toContain("insurance_type = '商业保险'");
  });

  it('should handle insurance_type=null (全部)', () => {
    const filters: AdvancedFilterState = {
      insurance_type: null,
    };

    const result = buildWhereClauseFromFilters(filters);

    expect(result).not.toContain('insurance_type');
    expect(result).toBe('1=1'); // Only default condition
  });

  it('should handle insurance_type=undefined (全部)', () => {
    const filters: AdvancedFilterState = {
      // insurance_type not set
    };

    const result = buildWhereClauseFromFilters(filters);

    expect(result).not.toContain('insurance_type');
    expect(result).toBe('1=1'); // Only default condition
  });

  it('should combine insurance_type with other filters', () => {
    const filters: AdvancedFilterState = {
      insurance_type: true,
      policy_date_start: '2025-01-01',
      policy_date_end: '2025-12-31',
      salesman_name: ['张三', '李四'],
    };

    const result = buildWhereClauseFromFilters(filters);

    expect(result).toContain("insurance_type = '交强险'");
    expect(result).toContain("policy_date >= '2025-01-01'");
    expect(result).toContain("policy_date <= '2025-12-31'");
    expect(result).toContain("salesman_name IN ('张三', '李四')");
  });

  it('should handle date_criteria for insurance_start_date', () => {
    const filters: AdvancedFilterState = {
      insurance_type: false,
      date_criteria: 'insurance_start_date',
      policy_date_start: '2025-01-01',
      policy_date_end: '2025-12-31',
    };

    const result = buildWhereClauseFromFilters(filters);

    expect(result).toContain("insurance_type = '商业保险'");
    expect(result).toContain("insurance_start_date >= '2025-01-01'");
    expect(result).toContain("insurance_start_date <= '2025-12-31'");
    expect(result).not.toContain("policy_date >="); // Should use insurance_start_date instead
  });

  it('should handle multiple boolean filters including insurance_type', () => {
    const filters: AdvancedFilterState = {
      insurance_type: true,
      is_renewal: true,
      is_new_car: false,
      is_nev: null, // Should be excluded
    };

    const result = buildWhereClauseFromFilters(filters);

    expect(result).toContain("insurance_type = '交强险'");
    expect(result).toContain('is_renewal = true');
    expect(result).toContain('is_new_car = false');
    expect(result).not.toContain('is_nev'); // null should be excluded
  });
});
