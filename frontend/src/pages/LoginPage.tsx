import { Navigate } from 'react-router-dom';
import { ErrorNotice, Spinner } from '../components';
import { isConfigured } from '../api';
import { useAuth } from '../auth';
import { GoogleSignInButton } from '../googleSignIn';

export function LoginPage() {
  const { user, loading, error, acceptGoogleCredential } = useAuth();

  if (user) return <Navigate to="/" replace />;
  return <main className="login-page">
    <section className="login-card" aria-labelledby="login-title">
      <div className="login-content">
        <img src={`${import.meta.env.BASE_URL}school-logo.svg`} alt="FEU Bataan Campus" className="login-logo" />
        <div className="login-title">
          <span>INTERNAL CONTROLS INITIATIVE</span>
          <h1 id="login-title">Electronic Request<br />for Approval</h1>
          <p>Create, route, review, and track institutional RFAs in one secure workspace.</p>
        </div>
        {!isConfigured() && <ErrorNotice message="This deployment is not configured. Set VITE_API_URL and VITE_GOOGLE_CLIENT_ID, then rebuild the frontend." />}
        <ErrorNotice message={error} />
        {loading ? <Spinner label="Verifying your Google account" /> : <GoogleSignInButton onCredential={(credential) => void acceptGoogleCredential(credential)} />}
        <p className="login-help">Sign in with your @feu.edu.ph Google account registered by your eRFA administrator. There is no public self-registration.</p>
      </div>
      <p className="login-credit">Developed by Piolo L. Bernardino</p>
    </section>
    <aside className="login-aside">
      <div className="login-aside-content">
        <span>FEU BATAAN CAMPUS</span>
        <b>Clear approvals. Complete accountability.</b>
        <p>Preserves the institutional RFA form with electronic routing, Drive attachments, Workspace email, and append-only history.</p>
      </div>
    </aside>
  </main>;
}
