import { isMicrosoftToken, microsoftTokenProblem, normalizeEmail, toBoolean } from './core';
import { all, findBy, getSetting, insert, newId, nowIso } from './store';
import { audit } from './audit';
import { timed } from './performance';
import type { DepartmentRecord, SessionUser, UserRecord } from './types';

function fail(message: string, code = 'UNAUTHORIZED'): never {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  throw error;
}

/** Reads the claims inside a sign-in token (JWT) without checking its signature. Empty when unreadable. */
function decodeJwtClaims(token: string): Record<string, unknown> {
  try {
    const part = String(token || '').split('.')[1] || '';
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const claims = JSON.parse(Utilities.newBlob(Utilities.base64Decode(padded)).getDataAsString('UTF-8')) as unknown;
    return claims && typeof claims === 'object' ? claims as Record<string, unknown> : {};
  } catch { return {}; }
}

/** Who signed in, as confirmed by Microsoft or Google. `emails` lists every address the account answers to. */
interface VerifiedIdentity { emails: string[]; name: string; provider: 'Microsoft' | 'Google' }

function tokenDigest(token: string): string {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 80);
}

/**
 * Microsoft 365 sign-in. The website sends a Microsoft Graph access token; reading the user's own
 * profile with it proves the token is genuine (Graph checks the signature). The token must come
 * from this school's tenant and the eRFA app registration (MS_TENANT_ID and MS_CLIENT_ID settings).
 */
function verifyMicrosoft(token: string, claims: Record<string, unknown>): VerifiedIdentity {
  const tenantId = getSetting('MS_TENANT_ID');
  const clientId = getSetting('MS_CLIENT_ID');
  if (!tenantId || !clientId) fail('Microsoft sign-in is not configured. Ask an administrator to set MS_TENANT_ID and MS_CLIENT_ID.', 'CONFIGURATION_REQUIRED');
  const problem = microsoftTokenProblem(claims, tenantId, clientId, Date.now());
  if (problem) fail(`Microsoft sign-in could not be accepted (${problem}). Please sign in again with your school account.`);
  const cache = CacheService.getScriptCache();
  const cacheKey = `mstoken:${tokenDigest(token)}`;
  const cached = timed('tokenCacheLookupMs', () => cache.get(cacheKey));
  if (cached) return JSON.parse(cached) as VerifiedIdentity;
  const response = timed('microsoftTokenVerificationHttpMs', () => UrlFetchApp.fetch('https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName', {
    headers: { Authorization: `Bearer ${token}` }, muteHttpExceptions: true
  }));
  if (response.getResponseCode() !== 200) fail('Microsoft sign-in could not be verified. Please sign in again.');
  const profile = JSON.parse(response.getContentText()) as { displayName?: string; mail?: string; userPrincipalName?: string };
  const emails = [...new Set([profile.userPrincipalName, profile.mail].map((value) => normalizeEmail(value || '')).filter(Boolean))];
  if (!emails.length) fail('Your Microsoft account has no email address.');
  const identity: VerifiedIdentity = { emails, name: profile.displayName || emails[0], provider: 'Microsoft' };
  // Remember the check until the token expires, so each user pays the Graph round trip once per sign-in.
  const secondsLeft = Math.floor(Number(claims.exp) - Date.now() / 1000);
  if (secondsLeft > 0) cache.put(cacheKey, JSON.stringify(identity), Math.min(secondsLeft, 21600));
  return identity;
}

/** Google sign-in (kept as an option): verifies a Google ID token for the GOOGLE_CLIENT_ID setting. */
function verifyGoogle(idToken: string): VerifiedIdentity {
  const clientId = getSetting('GOOGLE_CLIENT_ID');
  if (!clientId) fail('Sign-in is not configured. Ask an administrator to set MS_TENANT_ID and MS_CLIENT_ID (Microsoft 365).', 'CONFIGURATION_REQUIRED');
  const cache = CacheService.getScriptCache();
  const digest = tokenDigest(idToken);
  let claimsText = timed('tokenCacheLookupMs', () => cache.get(`idtoken:${digest}`));
  if (!claimsText) {
    const response = timed('googleTokenVerificationHttpMs', () => UrlFetchApp.fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, { muteHttpExceptions: true }));
    if (response.getResponseCode() !== 200) fail('Google sign-in could not be verified. Please sign in again.');
    claimsText = response.getContentText();
    // Cache the verified claims until the token itself expires (Google ID tokens last ~1 hour).
    // Expiry, audience, issuer and the user's ACTIVE flag are still re-checked on every request below.
    let secondsLeft = 0;
    try { secondsLeft = Math.floor(Number((JSON.parse(claimsText) as Record<string, string>).exp) - Date.now() / 1000); } catch { secondsLeft = 0; }
    if (secondsLeft > 0) cache.put(`idtoken:${digest}`, claimsText, Math.min(secondsLeft, 21600));
  }
  const claims = JSON.parse(claimsText) as Record<string, string>;
  if (claims.aud !== clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) fail('Google token audience or issuer is invalid.');
  if (claims.email_verified !== 'true' || Number(claims.exp) * 1000 <= Date.now()) fail('Google sign-in is expired or the email is not verified.');
  const email = normalizeEmail(claims.email);
  return { emails: [email], name: claims.name || email, provider: 'Google' };
}

export function authenticate(token: string): SessionUser {
  if (!token) fail('Sign in with your registered school account.');
  const claims = decodeJwtClaims(token);
  const identity = isMicrosoftToken(claims) ? verifyMicrosoft(token, claims) : verifyGoogle(token);
  const email = identity.emails[0];
  const allowedDomain = normalizeEmail(getSetting('ALLOWED_DOMAIN'));
  const preUser = all<UserRecord>('USERS').find((candidate) => identity.emails.includes(normalizeEmail(candidate.EMAIL)));
  // External-domain approvers are still registered in USERS and must be able to sign in to
  // approve; the domain restriction only blocks *unregistered* accounts.
  if (allowedDomain && !identity.emails.some((address) => address.endsWith(`@${allowedDomain}`)) && !preUser) fail(`Use your ${allowedDomain} school account.`);

  const user = preUser;
  if (!user) {
    audit('ACCESS_DENIED', { FULL_NAME: identity.name || email, EMAIL: email } as SessionUser, '', '', '', `${identity.provider} account is not registered.`);
    fail(`Your account (${email}) is not registered in eRFA. Ask an eRFA administrator to add you.`, 'NOT_REGISTERED');
  }
  if (!toBoolean(user.ACTIVE)) {
    audit('ACCESS_DENIED', user as SessionUser, '', '', '', 'Inactive user attempted access.');
    fail('Your eRFA account is inactive. Contact an administrator.', 'INACTIVE_USER');
  }
  const department = user.DEPARTMENT_ID ? findBy<DepartmentRecord>('DEPARTMENTS', 'DEPARTMENT_ID', user.DEPARTMENT_ID) : undefined;
  return { ...user, DEPARTMENT_NAME: department?.DEPARTMENT_NAME ?? '' };
}

export function requireCapability(user: SessionUser, capability: 'CAN_CREATE_RFA' | 'CAN_APPROVE_RFA' | 'CAN_IMPLEMENT_RFA' | 'IS_ADMIN'): void {
  if (!toBoolean(user[capability])) {
    audit('ACCESS_DENIED', user, '', '', '', `Missing capability ${capability}.`);
    fail('You do not have permission to perform this action.', 'FORBIDDEN');
  }
}

export function bootstrapAdmin(email: string, fullName: string): UserRecord {
  const admins = all<UserRecord>('USERS').filter((user) => toBoolean(user.IS_ADMIN));
  if (admins.length) throw new Error('An administrator already exists. Use the Admin UI to add or promote users.');
  const normalized = normalizeEmail(email);
  if (!normalized || !fullName.trim()) throw new Error('Email and full name are required.');
  const timestamp = nowIso();
  const admin: UserRecord = {
    USER_ID: newId('usr'), FULL_NAME: fullName.trim(), EMAIL: normalized, DEPARTMENT_ID: '', POSITION: '',
    CAN_CREATE_RFA: true, CAN_APPROVE_RFA: true, CAN_IMPLEMENT_RFA: true, IS_ADMIN: true, ACTIVE: true, CREATED_AT: timestamp, UPDATED_AT: timestamp
  };
  insert('USERS', admin);
  audit('USER_CREATED', admin as SessionUser, '', '', '', 'Initial administrator bootstrapped.');
  return admin;
}
