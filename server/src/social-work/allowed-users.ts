import bcrypt from 'bcrypt';

const HANLU_129_HASH = '$2b$10$MpXuVCIcKEVHNe801pamcuIbC1NvoiS49AVpGEtqG3yinW9Zd5KQu';

const ALLOWED_USERS = new Map<string, { displayName: string; studyCodeHash: string }>([
  ['zouwenjun', { displayName: 'zouwenjun', studyCodeHash: HANLU_129_HASH }],
  ['xuechenglong', { displayName: 'xuechenglong', studyCodeHash: HANLU_129_HASH }],
]);

export interface AllowedSocialWorkUser {
  displayName: string;
  studyCodeHash: string;
}

export function verifyAllowedSocialWorkUser(
  displayName: string,
  studyCode: string,
): AllowedSocialWorkUser | null {
  const normalizedName = displayName.trim().toLowerCase();
  const allowedUser = ALLOWED_USERS.get(normalizedName);
  if (!allowedUser || !bcrypt.compareSync(studyCode, allowedUser.studyCodeHash)) {
    return null;
  }
  return allowedUser;
}

export function isAllowedSocialWorkDisplayName(displayName: string): boolean {
  return ALLOWED_USERS.has(displayName.trim().toLowerCase());
}
