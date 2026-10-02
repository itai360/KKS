import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans-hebrew/400.css';
import '@fontsource/ibm-plex-sans-hebrew/500.css';
import '@fontsource/ibm-plex-sans-hebrew/600.css';
import '@fontsource/ibm-plex-sans-hebrew/700.css';
import '@fontsource/karantina/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import './styles.css';
import { App } from './App';
import { reportIssue } from './lib/api';
import { dropUnusedServiceWorker } from './lib/push';
import { watchForUpdates } from './lib/update';
import { applyTheme } from './lib/theme';

applyTheme();

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
