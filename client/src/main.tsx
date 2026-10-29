import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './apple.css';
import './gcal.css';
import './smart.css';
import './takpatz.css';
import { App } from './App';
import { reportIssue } from './lib/api';
import { watchInstall } from './lib/install';
import { watchKeyboard } from './lib/keyboard';
import { dropUnusedServiceWorker } from './lib/push';
import { watchForUpdates } from './lib/update';
import { applyTheme, onThemeChange, syncBrowserBar } from './lib/theme';

applyTheme();
// Chrome offers to install the app once, early - kept for the app's own install button (lib/install.ts)
watchInstall();
watchKeyboard();
// with a touch listener on the page, iPhone shows a pressed look the moment a finger lands (not after)
document.addEventListener('touchstart', () => undefined, { passive: true });
// the device switched between light and dark while following it: the browser's bar follows too
onThemeChange(syncBrowserBar);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void dropUnusedServiceWorker();
watchForUpdates();

// errors outside a screen still reach the server log
window.addEventListener('error', (e) => reportIssue(`error: ${e.message}`, { at: `${e.filename}:${e.lineno}` }));
window.addEventListener('unhandledrejection', (e) => reportIssue(`unhandled: ${String((e.reason as Error)?.message ?? e.reason)}`));
