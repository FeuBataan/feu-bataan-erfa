import { useEffect, useRef } from 'react';

/**
 * Picks up a new version of eRFA in tabs that stay open.
 *
 * The site's index.html names the main script by a content hash (assets/index-<hash>.js),
 * so a different name there means a new version was deployed. eRFA checks now and then
 * (when the tab comes back into view, and every 15 minutes) and, once a new version is out,
 * reloads at a safe moment: on the next page change, or right away when the tab comes back
 * into view on a page with nothing being typed.
 */

const CHECK_EVERY_MS = 15 * 60_000;
const MIN_GAP_MS = 2 * 60_000;
const ENTRY = /assets\/index-[\w-]+\.js/;

let updateReady = false;
let lastCheck = 0;

/** The main script this tab is running, or '' in development (no hashed build). */
export function runningEntry(doc: Pick<Document, 'querySelectorAll'> = document): string {
  for (const script of Array.from(doc.querySelectorAll('script[type="module"][src]'))) {
    const match = ENTRY.exec(script.getAttribute('src') || '');
    if (match) return match[0];
  }
  return '';
}

/** The main script named by the published index.html, or '' if it can't be read. */
export function publishedEntry(html: string): string {
  return ENTRY.exec(html)?.[0] ?? '';
}

async function checkForUpdate(force = false): Promise<boolean> {
  if (updateReady) return true;
  const running = runningEntry();
  if (!running) return false;
  if (!force && Date.now() - lastCheck < MIN_GAP_MS) return false;
  lastCheck = Date.now();
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}index.html?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return false;
    const published = publishedEntry(await response.text());
    updateReady = Boolean(published) && published !== running;
  } catch { /* offline: try again later */ }
  return updateReady;
}

/** Nothing would be lost by reloading: not on a form and no dialog open. */
function safeToReloadNow(pathname: string): boolean {
  const onForm = pathname === '/rfa/new' || pathname.endsWith('/edit') || pathname.startsWith('/admin');
  return !onForm && !document.querySelector('.dialog-backdrop');
}

export function useAppUpdates(pathname: string): void {
  const firstPath = useRef(true);

  // A page change is always a safe moment.
  useEffect(() => {
    if (firstPath.current) { firstPath.current = false; return; }
    if (updateReady) window.location.reload();
    else void checkForUpdate(); // at most every 2 minutes; a new version then loads on the next page change
  }, [pathname]);

  const path = useRef(pathname);
  path.current = pathname;

  useEffect(() => {
    if (!runningEntry()) return undefined;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void checkForUpdate().then((ready) => { if (ready && safeToReloadNow(path.current)) window.location.reload(); });
    };
    const timer = window.setInterval(() => { void checkForUpdate(true); }, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);
}
