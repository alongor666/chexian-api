export type OrgSalesmanCache = Record<string, string[]>;

type OrgSalesmanRow = {
  org_level_3: string;
  salesman_name: string;
};

export const buildOrgSalesmanCache = (rows: OrgSalesmanRow[]): OrgSalesmanCache => {
  const cache: OrgSalesmanCache = {};
  rows.forEach((row) => {
    const org = row.org_level_3;
    const salesman = row.salesman_name;
    if (!org || !salesman) return;
    if (!cache[org]) cache[org] = [];
    if (!cache[org].includes(salesman)) cache[org].push(salesman);
  });
  return cache;
};

export const getAvailableSalesmen = (
  selectedOrgs: string[] | undefined,
  cache: OrgSalesmanCache,
  allSalesmen: string[]
): string[] => {
  if (!selectedOrgs || selectedOrgs.length === 0) {
    return allSalesmen;
  }

  const salesmenSet = new Set<string>();
  selectedOrgs.forEach((org) => {
    const salesmen = cache[org] || [];
    salesmen.forEach((salesman) => salesmenSet.add(salesman));
  });

  return Array.from(salesmenSet);
};
