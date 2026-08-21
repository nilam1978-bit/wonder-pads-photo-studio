import { useEffect, useState } from 'react';
import './InstallPrompt.css';

const DISMISSED_KEY = 'wp-photo-studio-install-dismissed';

// A small blush-pink banner offering to install the app to the home
// screen / app list. Chrome and other Chromium browsers fire
// 'beforeinstallprompt' when a page meets install criteria (manifest +
// service worker, both already set up) — we stash that event and trigger
// it ourselves from a button, since the browser's own address-bar icon
// is easy to miss. Safari/iOS never fires this event, so there's simply
// nothing to show there; "Add to Home Screen" is still available from
// the share sheet as usual.
export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const handleInstalled = () => {
      setDeferredPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const alreadyStandalone =
    typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches;

  if (!deferredPrompt || dismissed || alreadyStandalone) return null;

  const handleInstall = async () => {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Private browsing etc. — dismissing just won't persist, that's fine.
    }
  };

  return (
    <div className="install-prompt" role="status">
      <span className="install-prompt-text">Install Wonder Pads Photo Studio for quicker access — works offline too.</span>
      <div className="install-prompt-actions">
        <button type="button" className="install-prompt-install" onClick={handleInstall}>
          Install
        </button>
        <button type="button" className="install-prompt-dismiss" onClick={handleDismiss} aria-label="Dismiss">
          ×
        </button>
      </div>
    </div>
  );
}
