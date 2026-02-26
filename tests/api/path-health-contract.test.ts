import { describe, expect, it } from 'vitest';
import { getCandidateDataDirs, getDataDir, getSalesmanMappingPaths } from '../../server/src/config/paths';

describe('path health contract', () => {
  it('includes warehouse and server/data candidate dirs in stable order', () => {
    const dirs = getCandidateDataDirs();
    expect(dirs.length).toBeGreaterThanOrEqual(2);
    expect(dirs[0]).toContain('数据管理/warehouse/fact/policy');
    expect(dirs[1]).toContain('/server/data');
  });

  it('salesman mapping has primary and fallback path', () => {
    const paths = getSalesmanMappingPaths();
    expect(paths).toHaveLength(2);
    expect(paths[0]).toContain('数据管理/warehouse/dim/业务员归属与规划/salesman_organization_mapping.json');
    expect(paths[1]).toBe(`${getDataDir()}/salesman_organization_mapping.json`);
  });
});
