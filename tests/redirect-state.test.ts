import { describe, expect, it } from 'vitest';
import { buildRedirectState, resolveRedirectPath } from '../src/shared/utils/redirect-state';

describe('redirect state contract', () => {
  it('builds normalized fromPath payload', () => {
    expect(buildRedirectState('dashboard')).toEqual({ fromPath: '/dashboard' });
    expect(buildRedirectState('/growth')).toEqual({ fromPath: '/growth' });
  });

  it('resolves new contract payload', () => {
    expect(resolveRedirectPath({ fromPath: '/cost' }, '/')).toBe('/cost');
  });

  it('resolves legacy payloads for backward compatibility', () => {
    expect(resolveRedirectPath('/truck', '/')).toBe('/truck');
    expect(resolveRedirectPath({ from: '/renewal' }, '/')).toBe('/renewal');
    expect(resolveRedirectPath({ from: { pathname: '/cross-sell' } }, '/')).toBe('/cross-sell');
    expect(resolveRedirectPath({ pathname: '/dashboard' }, '/')).toBe('/dashboard');
  });

  it('falls back safely when target is missing or points to login', () => {
    expect(resolveRedirectPath(undefined, '/dashboard')).toBe('/dashboard');
    expect(resolveRedirectPath({ fromPath: '/login' }, '/dashboard')).toBe('/dashboard');
    expect(resolveRedirectPath({ fromPath: '' }, '/dashboard')).toBe('/dashboard');
  });
});
