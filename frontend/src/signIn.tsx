import { GoogleSignInButton } from './googleSignIn';
import { MicrosoftSignInButton, microsoftSignInEnabled } from './microsoftSignIn';

const googleSignInEnabled = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

/** True when at least one sign-in method is configured for this build. */
export const signInConfigured = microsoftSignInEnabled || googleSignInEnabled;

/** The sign-in buttons this deployment uses: Microsoft 365 first, Google only if also configured. */
export function SignInButtons({ onCredential, loginHint = '' }: { onCredential: (token: string) => void; loginHint?: string }) {
  return <div className="sign-in-buttons">
    {microsoftSignInEnabled && <MicrosoftSignInButton onCredential={onCredential} loginHint={loginHint} />}
    {googleSignInEnabled && <GoogleSignInButton onCredential={onCredential} />}
  </div>;
}
