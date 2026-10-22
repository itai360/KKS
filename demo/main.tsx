// Entry of the in-browser demo: starts the server inside the page, then the app.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import '../client/src/styles.css';
import { AppShell } from '../client/src/App';
import { applyTheme } from '../client/src/lib/theme';
import { boot } from './bridge';

// The page's frame never shows confirm() dialogs (they always answer "no"),
// so the demo treats every confirmation as accepted.
window.confirm = () => true;

const root = document.getElementById('root')!;
applyTheme();

boot()
  .then(() =>
    createRoot(root).render(
      <StrictMode>
        <MemoryRouter>
          <AppShell />
        </MemoryRouter>
      </StrictMode>,
    ),
  )
  .catch((e: Error) => {
    console.error(e);
    root.innerHTML = '';
    const box = document.createElement('div');
    box.style.cssText = 'max-width:520px;margin:15vh auto;padding:0 16px;font-family:"IBM Plex Sans Hebrew",system-ui,sans-serif;text-align:center';
    box.innerHTML = '<h2 style="margin:0 0 8px">ההדגמה לא נטענה</h2><p style="margin:0">רעננו את הדף. אם זה חוזר, ייתכן שהדפדפן חוסם סקריפטים חיצוניים.</p>';
    const detail = document.createElement('p');
    detail.style.cssText = 'opacity:.6;font-size:12px;direction:ltr';
    detail.textContent = e.message;
    box.append(detail);
    root.append(box);
  });
