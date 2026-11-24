import { useState } from 'react';
import type { IPublicClientApplication } from '@azure/msal-browser';

/**
 * "Sign in with Microsoft" for Microsoft 365 schools. The site asks Microsoft (in a pop-up) for a
 * Microsoft Graph token with the User.Read permission and sends it to the eRFA backend, which reads
 * the user's own profile with it to confirm who they are. MSAL keeps the sign-in for this tab only
 * (sessionStorage) and renews the token quietly, so users are not asked to sign in every hour.
 */
const CLIENT_ID = (import.meta.env.VITE_MS_CLIENT_ID as string | undefined) ?? '';
const TENANT_ID = (import.meta.env.VITE_MS_TENANT_ID as string | undefined) ?? '';
const SCOPES = ['User.Read'];

export const microsoftSignInEnabled = Boolean(CLIENT_ID && TENANT_ID);

const SIGNED_OUT_KEY = 'erfa_signed_out';
/** Remember an explicit eRFA sign-out in this tab, so single sign-on does not sign the person straight back in. */
export function rememberSignedOut(signedOut: boolean): void {
  try { if (signedOut) sessionStorage.setItem(SIGNED_OUT_KEY, '1'); else sessionStorage.removeItem(SIGNED_OUT_KEY); } catch { /* storage unavailable */ }
}
export function signedOutHere(): boolean { try { return sessionStorage.getItem(SIGNED_OUT_KEY) === '1'; } catch { return false; } }

let clientPromise: Promise<IPublicClientApplication> | null = null;

/** Load MSAL only when Microsoft sign-in is used, and create one client for the whole visit. */
function client(): Promise<IPublicClientApplication> {
  clientPromise ??= import('@azure/msal-browser').then(({ createStandardPublicClientApplication }) => createStandardPublicClientApplication({
    auth: {
      clientId: CLIENT_ID,
      authority: `https://login.microsoftonline.com/${TENANT_ID}`,
      // The pop-up returns to this small page, which hands the result back to this window.
      redirectUri: new URL(`${import.meta.env.BASE_URL}auth-redirect.html`, window.location.origin).href
    },
    cache: { cacheLocation: 'sessionStorage' },
    // Give people time to type a password and finish MFA in the pop-up; give up quickly on quiet single sign-on.
    system: { popupBridgeTimeout: 5 * 60_000, iframeBridgeTimeout: 6_000 }
  })).catch((error: unknown) => { clientPromise = null; throw error; });
  return clientPromise;
}

/** Friendly wording for the sign-in problems people actually meet. Empty when the user just closed the pop-up. */
export function microsoftErrorMessage(error: unknown): string {
  const code = String((error as { errorCode?: string })?.errorCode ?? '');
  if (code === 'user_cancelled') return '';
  if (code === 'popup_window_error' || code === 'empty_window_error') return 'The Microsoft sign-in window was blocked. Allow pop-ups for this site, then try again.';
  if (code === 'interaction_in_progress') return 'A Microsoft sign-in window is already open. Finish or close it, then try again.';
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/AADSTS50020|AADSTS90072/.test(message)) return 'Use your school Microsoft 365 account. Accounts from other organizations cannot sign in.';
  if (/AADSTS65001|consent/i.test(message)) return 'eRFA has not been approved in your school Microsoft 365 yet. Ask the IT administrator to grant consent for the eRFA app.';
  return 'Microsoft sign-in did not finish. Please try again.';
}

/** Opens the Microsoft sign-in pop-up and returns the token for the eRFA backend. */
export async function signInWithMicrosoft(loginHint = ''): Promise<string> {
  const msal = await client();
  const result = await msal.loginPopup({ scopes: SCOPES, prompt: 'select_account', ...(loginHint ? { loginHint } : {}) });
  msal.setActiveAccount(result.account);
  return result.accessToken;
}

/** A fresh token without any window, or '' when the user must sign in again. */
export async function renewMicrosoftToken(): Promise<string> {
  if (!microsoftSignInEnabled) return '';
  try {
    const msal = await client();
    const account = msal.getActiveAccount() ?? msal.getAllAccounts()[0];
    if (!account) return '';
    return (await msal.acquireTokenSilent({ scopes: SCOPES, account })).accessToken;
  } catch { return ''; }
}

/**
 * Single sign-on: when the person is already signed in to Microsoft 365 in this browser (Outlook,
 * Teams, Office), get their token with no click and no window. Returns '' when that is not possible
 * (signed out, several accounts, or the browser blocks it), and the button is shown instead.
 */
export async function trySingleSignOn(): Promise<string> {
  if (!microsoftSignInEnabled) return '';
  const quick = await renewMicrosoftToken();
  if (quick) return quick;
  try {
    const msal = await client();
    const result = await msal.ssoSilent({ scopes: SCOPES });
    msal.setActiveAccount(result.account);
    return result.accessToken;
  } catch { return ''; }
}

/** Forget the Microsoft sign-in in this tab (eRFA sign-out). Does not sign the user out of Microsoft 365 itself. */
export function forgetMicrosoftSignIn(): void {
  if (!clientPromise) return;
  void clientPromise.then((msal) => msal.clearCache()).catch(() => undefined);
}

function MicrosoftLogo() {
  return <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden focusable="false">
    <rect x="1" y="1" width="9" height="9" fill="#f25022" /><rect x="11" y="1" width="9" height="9" fill="#7fba00" />
    <rect x="1" y="11" width="9" height="9" fill="#00a4ef" /><rect x="11" y="11" width="9" height="9" fill="#ffb900" />
  </svg>;
}

/** The "Sign in with Microsoft" button. Reports the token, or shows why sign-in did not work. */
export function MicrosoftSignInButton({ onCredential, loginHint = '' }: { onCredential: (token: string) => void; loginHint?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function start() {
    setBusy(true); setError('');
    try { onCredential(await signInWithMicrosoft(loginHint)); }
    catch (caught) { setError(microsoftErrorMessage(caught)); }
    finally { setBusy(false); }
  }
  return <>
    {error && <div className="notice error" role="alert">{error}</div>}
    <button type="button" className="microsoft-button" onClick={() => void start()} disabled={busy}>
      <MicrosoftLogo /><span>{busy ? 'Waiting for Microsoft…' : 'Sign in with Microsoft'}</span>
    </button>
  </>;
}
