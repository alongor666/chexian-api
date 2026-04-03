export const DEFAULT_E2E_USERNAME = process.env.E2E_USERNAME ?? 'admin';
export const DEFAULT_E2E_PASSWORD = process.env.E2E_PASSWORD ?? (() => {
  throw new Error('E2E_PASSWORD environment variable is required. Set it before running E2E tests.');
})();
