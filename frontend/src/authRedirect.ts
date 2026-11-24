import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';

// Runs inside the Microsoft sign-in pop-up: passes the answer back to the eRFA window, which closes the pop-up.
broadcastResponseToMainFrame().catch(() => {
  document.body.textContent = 'Sign-in could not be finished here. Close this window and try again from eRFA.';
});
