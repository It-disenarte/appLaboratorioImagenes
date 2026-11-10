// Network-first: siempre intenta lo más nuevo. Se guarda en caché solo la "cáscara" (páginas y estáticos)
// para que la app abra sin conexión; /api nunca se cachea. Las imágenes se procesan en el dispositivo
// y no se guardan en ningún lado.
const CACHE = 'laboratorio-v2'; // v2: ya no existe /login
const SHELL = ['/', '/manifest.json', '/favicon.svg?v=1', '/favicon.ico?v=1', '/icono-192.png', '/icono-512.png', '/icono-512-maskable.png', '/apple-touch-icon.png?v=1', '/textura.jpg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/vendor/') || url.pathname.startsWith('/models/')) return; // /vendor: motor pesado, lo cachea el navegador

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') return (await caches.match('/')) || new Response('Sin conexión', { status: 503 });
        return new Response('', { status: 503 });
      })
  );
});
