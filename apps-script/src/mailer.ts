import { getSetting, settingBoolean } from './store';

/**
 * Sends every eRFA email. When MAIL_SENDER is set (for example erfa@uncbataan.edu.ph), mail goes
 * out from that Outlook mailbox through Microsoft Graph, using the eRFA app registration
 * (MS_TENANT_ID, MS_CLIENT_ID settings) and its secret, kept in Script Properties as
 * MS_CLIENT_SECRET so it never appears in the database. If Outlook is not set up, or it fails and
 * MAIL_FALLBACK_TO_GOOGLE is TRUE, the email goes through Google MailApp instead.
 */
export interface MailMessage { to: string; subject: string; body: string }

const TOKEN_CACHE_KEY = 'graph:app-token';

/** Recipient list for Graph: one entry per distinct address in a comma-separated "to". */
export function graphRecipients(to: string): Array<{ emailAddress: { address: string } }> {
  return [...new Set(String(to || '').split(/[,;]/).map((address) => address.trim()).filter(Boolean))]
    .map((address) => ({ emailAddress: { address } }));
}

/** The Graph sendMail request body for a plain-text eRFA email. */
export function graphMailPayload(message: MailMessage): Record<string, unknown> {
  return {
    message: { subject: message.subject, body: { contentType: 'Text', content: message.body }, toRecipients: graphRecipients(message.to) },
    saveToSentItems: false
  };
}

function clientSecret(): string {
  try { return PropertiesService.getScriptProperties().getProperty('MS_CLIENT_SECRET') || ''; } catch { return ''; }
}

/** True when everything needed to send from Outlook is filled in. */
export function outlookConfigured(): boolean {
  return Boolean(getSetting('MAIL_SENDER') && getSetting('MS_TENANT_ID') && getSetting('MS_CLIENT_ID') && clientSecret());
}

/** App-only Microsoft Graph token (client credentials), reused until shortly before it expires. */
function graphAppToken(): string {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(TOKEN_CACHE_KEY);
  if (cached) return cached;
  const response = UrlFetchApp.fetch(`https://login.microsoftonline.com/${encodeURIComponent(getSetting('MS_TENANT_ID'))}/oauth2/v2.0/token`, {
    method: 'post',
    payload: { client_id: getSetting('MS_CLIENT_ID'), client_secret: clientSecret(), scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' },
    muteHttpExceptions: true
  });
  const result = JSON.parse(response.getContentText() || '{}') as { access_token?: string; expires_in?: number; error_description?: string };
  if (response.getResponseCode() !== 200 || !result.access_token) {
    throw new Error(`Outlook sign-in failed: ${(result.error_description || `HTTP ${response.getResponseCode()}`).split('\n')[0]}`);
  }
  const keepSeconds = Math.max(60, Math.min(21600, Number(result.expires_in || 3600) - 300));
  cache.put(TOKEN_CACHE_KEY, result.access_token, keepSeconds);
  return result.access_token;
}

function sendThroughOutlook(message: MailMessage): void {
  const sender = getSetting('MAIL_SENDER').trim();
  const response = UrlFetchApp.fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: 'post', contentType: 'application/json', headers: { Authorization: `Bearer ${graphAppToken()}` },
    payload: JSON.stringify(graphMailPayload(message)), muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code === 202 || code === 200) return;
  if (code === 401) CacheService.getScriptCache().remove(TOKEN_CACHE_KEY);
  let detail = `HTTP ${code}`;
  try { detail = (JSON.parse(response.getContentText()) as { error?: { message?: string } }).error?.message || detail; } catch { /* keep HTTP code */ }
  throw new Error(`Outlook could not send the email: ${detail}`);
}

function sendThroughGoogle(message: MailMessage): void {
  MailApp.sendEmail({ to: message.to, subject: message.subject, body: message.body, name: 'eRFA' });
}

/** Send one email. Throws only when no route worked, so callers can log the failure for retry. */
export function sendEmail(message: MailMessage): 'outlook' | 'google' {
  if (!outlookConfigured()) { sendThroughGoogle(message); return 'google'; }
  try { sendThroughOutlook(message); return 'outlook'; }
  catch (outlookError) {
    const fallback = getSetting('MAIL_FALLBACK_TO_GOOGLE') === '' || settingBoolean('MAIL_FALLBACK_TO_GOOGLE');
    if (!fallback) throw outlookError;
    console.warn('[eRFA] Outlook email failed, sending through Google instead:', outlookError instanceof Error ? outlookError.message : String(outlookError));
    sendThroughGoogle(message);
    return 'google';
  }
}

/**
 * For the Apps Script editor: sends one test email from the Outlook mailbox to itself, without
 * the Google fallback, so a setup problem shows clearly in the log.
 */
export function testOutlookEmail(): string {
  const sender = getSetting('MAIL_SENDER').trim();
  if (!outlookConfigured()) {
    const missing = [
      !sender && 'MAIL_SENDER (SETTINGS sheet)', !getSetting('MS_TENANT_ID') && 'MS_TENANT_ID (SETTINGS sheet)',
      !getSetting('MS_CLIENT_ID') && 'MS_CLIENT_ID (SETTINGS sheet)', !clientSecret() && 'MS_CLIENT_SECRET (Project Settings > Script Properties)'
    ].filter(Boolean).join(', ');
    throw new Error(`Outlook email is not set up yet. Missing: ${missing}`);
  }
  sendThroughOutlook({ to: sender, subject: '[eRFA] Outlook test email', body: `This test email was sent by eRFA through Microsoft 365 from ${sender}.\n\nIf you can read this, Outlook email is working.` });
  return `Test email sent from ${sender} to ${sender}. Check that mailbox.`;
}
