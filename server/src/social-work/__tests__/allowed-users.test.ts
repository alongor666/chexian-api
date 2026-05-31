import { describe, expect, it } from 'vitest';
import { isAllowedSocialWorkDisplayName, verifyAllowedSocialWorkUser } from '../allowed-users.js';

describe('verifyAllowedSocialWorkUser', () => {
  it('allows only the configured social-work learners', () => {
    expect(verifyAllowedSocialWorkUser('zouwenjun', 'hanlu129')?.displayName).toBe('zouwenjun');
    expect(verifyAllowedSocialWorkUser('xuechenglong', 'hanlu129')?.displayName).toBe('xuechenglong');
    expect(verifyAllowedSocialWorkUser('other', 'hanlu129')).toBeNull();
    expect(verifyAllowedSocialWorkUser('zouwenjun', 'wrong')).toBeNull();
    expect(isAllowedSocialWorkDisplayName('zouwenjun')).toBe(true);
    expect(isAllowedSocialWorkDisplayName('other')).toBe(false);
  });
});
