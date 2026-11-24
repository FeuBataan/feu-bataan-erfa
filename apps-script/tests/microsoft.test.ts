import { beforeEach, describe, expect, it, vi } from 'vitest';

const settings = new Map<string, string>();
vi.mock('../src/store', () => ({
  getSetting: (key: string) => settings.get(key) ?? '',
  settingBoolean: (key: string) => String(settings.get(key) ?? '').toUpperCase() === 'TRUE'
}));

import { isMicrosoftToken, microsoftTokenProblem } from '../src/core';
import { graphMailPayload, graphRecipients, sendEmail } from '../src/mailer';

const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const now = Date.parse('2026-11-24T08:00:00Z');
const good = { iss: `https://sts.windows.net/${TENANT}/`, aud: '00000003-0000-0000-c000-000000000000', tid: TENANT, appid: CLIENT, exp: now / 1000 + 3600 };

describe('Microsoft sign-in token checks', () => {
  it('recognises Microsoft tokens', () => {
    expect(isMicrosoftToken(good)).toBe(true);
    expect(isMicrosoftToken({ iss: `https://login.microsoftonline.com/${TENANT}/v2.0` })).toBe(true);
    expect(isMicrosoftToken({ iss: 'https://accounts.google.com' })).toBe(false);
    expect(isMicrosoftToken({})).toBe(false);
  });

  it('accepts a token from this school and this app', () => {
    expect(microsoftTokenProblem(good, TENANT, CLIENT, now)).toBe('');
    expect(microsoftTokenProblem({ ...good, aud: 'https://graph.microsoft.com', appid: undefined, azp: CLIENT.toUpperCase() }, TENANT, CLIENT, now)).toBe('');
  });

  it('refuses other organizations, other apps, other audiences and expired tokens', () => {
    expect(microsoftTokenProblem({ ...good, tid: 'another-tenant' }, TENANT, CLIENT, now)).toMatch(/another organization/);
    expect(microsoftTokenProblem({ ...good, appid: 'graph-explorer' }, TENANT, CLIENT, now)).toMatch(/another app/);
    expect(microsoftTokenProblem({ ...good, aud: 'api://something-else' }, TENANT, CLIENT, now)).toMatch(/audience/);
    expect(microsoftTokenProblem({ ...good, exp: now / 1000 - 1 }, TENANT, CLIENT, now)).toMatch(/expired/);
    expect(microsoftTokenProblem(good, '', CLIENT, now)).toMatch(/another organization/);
  });
});

describe('Outlook email', () => {
  const sentByGoogle: string[] = [];
  const graphCalls: string[] = [];
  let graphStatus = 202;
  const props = new Map<string, string>();

  beforeEach(() => {
    settings.clear(); props.clear(); sentByGoogle.length = 0; graphCalls.length = 0; graphStatus = 202;
    vi.stubGlobal('MailApp', { sendEmail: (m: { to: string }) => { sentByGoogle.push(m.to); } });
    vi.stubGlobal('PropertiesService', { getScriptProperties: () => ({ getProperty: (k: string) => props.get(k) ?? null }) });
    const cache = new Map<string, string>();
    vi.stubGlobal('CacheService', { getScriptCache: () => ({ get: (k: string) => cache.get(k) ?? null, put: (k: string, v: string) => { cache.set(k, v); }, remove: (k: string) => { cache.delete(k); } }) });
    vi.stubGlobal('UrlFetchApp', { fetch: (url: string) => {
      graphCalls.push(url);
      if (url.includes('/oauth2/v2.0/token')) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ access_token: 'app-token', expires_in: 3600 }) };
      return { getResponseCode: () => graphStatus, getContentText: () => graphStatus === 202 ? '' : JSON.stringify({ error: { message: 'Access is denied.' } }) };
    } });
  });

  function configureOutlook() {
    settings.set('MAIL_SENDER', 'erfa@uncbataan.edu.ph'); settings.set('MS_TENANT_ID', TENANT); settings.set('MS_CLIENT_ID', CLIENT);
    props.set('MS_CLIENT_SECRET', 'secret');
  }

  it('builds a plain-text Graph message with one recipient per address', () => {
    expect(graphRecipients('a@x.ph, b@x.ph;a@x.ph')).toEqual([{ emailAddress: { address: 'a@x.ph' } }, { emailAddress: { address: 'b@x.ph' } }]);
    expect(graphMailPayload({ to: 'a@x.ph', subject: 'S', body: 'B' })).toEqual({
      message: { subject: 'S', body: { contentType: 'Text', content: 'B' }, toRecipients: [{ emailAddress: { address: 'a@x.ph' } }] }, saveToSentItems: false
    });
  });

  it('uses Google MailApp until Outlook is fully set up', () => {
    settings.set('MAIL_SENDER', 'erfa@uncbataan.edu.ph');
    expect(sendEmail({ to: 'staff@uncbataan.edu.ph', subject: 'S', body: 'B' })).toBe('google');
    expect(sentByGoogle).toEqual(['staff@uncbataan.edu.ph']);
    expect(graphCalls).toEqual([]);
  });

  it('sends from the Outlook mailbox when set up, reusing the app token', () => {
    configureOutlook();
    expect(sendEmail({ to: 'staff@uncbataan.edu.ph', subject: 'S', body: 'B' })).toBe('outlook');
    expect(sendEmail({ to: 'head@uncbataan.edu.ph', subject: 'S', body: 'B' })).toBe('outlook');
    expect(graphCalls.filter((url) => url.includes('/token'))).toHaveLength(1);
    expect(graphCalls.filter((url) => url.endsWith('/users/erfa%40uncbataan.edu.ph/sendMail'))).toHaveLength(2);
    expect(sentByGoogle).toEqual([]);
  });

  it('falls back to Google when Outlook fails, unless the fallback is turned off', () => {
    configureOutlook(); graphStatus = 403;
    expect(sendEmail({ to: 'staff@uncbataan.edu.ph', subject: 'S', body: 'B' })).toBe('google');
    expect(sentByGoogle).toEqual(['staff@uncbataan.edu.ph']);
    settings.set('MAIL_FALLBACK_TO_GOOGLE', 'FALSE');
    expect(() => sendEmail({ to: 'staff@uncbataan.edu.ph', subject: 'S', body: 'B' })).toThrow(/Access is denied/);
  });
});
