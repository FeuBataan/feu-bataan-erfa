import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ErrorNotice, Spinner } from '../components';
import { getToken, isConfigured } from '../api';
import { useAuth } from '../auth';
import { rememberSignedOut, signedOutHere, trySingleSignOn } from '../microsoftSignIn';
import { SignInButtons } from '../signIn';

let singleSignOnTried = false;

export function LoginPage() {
  const { user, loading, error, acceptCredential } = useAuth();
  const [checkingSso, setCheckingSso] = useState(() => !singleSignOnTried && !signedOutHere() && !getToken() && isConfigured());

  // Single sign-on: someone already signed in to Microsoft 365 in this browser goes straight in.
  // Tried once per visit, and never right after the person signed out of eRFA in this tab.
  useEffect(() => {
    if (!checkingSso) return;
    singleSignOnTried = true;
    let alive = true;
    void trySingleSignOn().then(async (token) => {
      if (alive && token) await acceptCredential(token);
    }).finally(() => { if (alive) setCheckingSso(false); });
    return () => { alive = false; };
  }, [checkingSso, acceptCredential]);

  if (user) return <Navigate to="/" replace />;
  const signIn = (token: string) => { rememberSignedOut(false); void acceptCredential(token); };
  return <main className="login-page">
    <section className="login-card" aria-labelledby="login-title">
      <div className="login-content">
        <img src={`${import.meta.env.BASE_URL}school-logo.svg`} alt="FEU Bataan Campus" className="login-logo" />
        <div className="login-title">
          <span>INTERNAL CONTROLS INITIATIVE</span>
          <h1 id="login-title">Electronic Request<br />for Approval</h1>
          <p>Create, route, review, and track institutional RFAs in one secure workspace.</p>
        </div>
        {!isConfigured() && <ErrorNotice message="This deployment is not configured. Set VITE_API_URL, VITE_MS_CLIENT_ID and VITE_MS_TENANT_ID, then rebuild the frontend." />}
        <ErrorNotice message={error} />
        {loading || checkingSso
          ? <Spinner label={checkingSso ? 'Checking your Microsoft 365 sign-in' : 'Verifying your account'} />
          : <SignInButtons onCredential={signIn} />}
        <p className="login-help">Sign in with your @uncbataan.edu.ph Microsoft 365 account, the same one you use for Outlook and Teams. Your eRFA administrator registers who can use eRFA; there is no public self-registration.</p>
      </div>
      <p className="login-credit">Developed by Piolo L. Bernardino</p>
    </section>
    <aside className="login-aside">
      <div className="login-aside-content">
        <span>FEU BATAAN CAMPUS</span>
        <b>Clear approvals. Complete accountability.</b>
        <p>Preserves the institutional RFA form with electronic routing, secure attachments, Outlook email notices, and append-only history.</p>
      </div>
    </aside>
  </main>;
}
