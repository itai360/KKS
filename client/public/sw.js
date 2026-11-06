// Service worker: shows push notifications when the app is closed and opens the
// right screen when one is tapped. No offline caching on purpose - the course
// data must always be live.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'ניהול קורס קק"ס';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag,
      dir: 'rtl',
      lang: 'he',
      icon: '/icon-192.png',
      // the small icon in an Android phone's status bar: Android reads only its shape, so it is white on clear
      badge: '/badge-96.png',
      requireInteraction: data.category === 'exception',
      // when it happened, as the phone lists it (not when the phone got around to showing it)
      timestamp: typeof data.at === 'number' ? data.at : Date.now(),
      data: { link: data.link || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // only a screen of this site: a link elsewhere opens the home screen instead
  const target = new URL((event.notification.data && event.notification.data.link) || '/', self.location.origin);
  const url = target.origin === self.location.origin ? target.href : self.location.origin + '/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
          if ('navigate' in w && (await w.navigate(url).catch(() => null))) return w.focus();
          // a browser that does not let the worker move the page (or a page it does not control): the page goes
          // there itself (lib/launch.ts) - and does not take the moment to open on its snapshot instead
          w.postMessage({ type: 'open', link: url });
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
