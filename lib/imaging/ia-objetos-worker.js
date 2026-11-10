// Relleno de precisión para "Quitar objetos": modelo LaMa (Carve/LaMa-ONNX, licencia Apache-2.0) en el navegador.
// Recibe un recorte de 512×512 (RGB) y su máscara (255 = rellenar) y devuelve el recorte ya rellenado.
// El modelo (~200 MB) se descarga una sola vez y se guarda en la caché del navegador; nada sale del equipo.
const URL_MODELO = 'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx';
const CACHE = 'modelo-relleno-v1';
const N = 512;

let ort = null;
let sesion = null;

async function bajarModelo(avisar) {
  try {
    const c = await caches.open(CACHE);
    const hit = await c.match(URL_MODELO);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  } catch { /* sin caché disponible */ }
  const resp = await fetch(URL_MODELO);
  if (!resp.ok || !resp.body) throw new Error('No se pudo descargar el componente de relleno. Revisa tu conexión e inténtalo de nuevo.');
  const total = Number(resp.headers.get('content-length')) || 208e6;
  const lector = resp.body.getReader();
  const trozos = [];
  let bajado = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    trozos.push(value); bajado += value.length;
    avisar('Preparando el relleno de precisión (solo la primera vez)…', 0.05 + 0.45 * Math.min(1, bajado / total));
  }
  const buf = new Uint8Array(bajado);
  let o = 0;
  for (const t of trozos) { buf.set(t, o); o += t.length; }
  try { const c = await caches.open(CACHE); await c.put(URL_MODELO, new Response(buf.slice())); } catch { /* si no cabe en caché, se descargará de nuevo la próxima vez */ }
  return buf;
}

async function preparar(avisar) {
  if (sesion) return sesion;
  ort = await import(/* webpackIgnore: true */ '/vendor/ia/ort.wasm.min.mjs');
  ort.env.wasm.wasmPaths = '/vendor/ia/';
  ort.env.wasm.numThreads = 1;
  const buf = await bajarModelo(avisar);
  avisar('Preparando el relleno de precisión…', 0.55);
  sesion = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
  return sesion;
}

self.onmessage = async (e) => {
  const { id, rgb, mask } = e.data;
  const avisar = (msg, p) => self.postMessage({ id, tipo: 'progreso', msg, p });
  try {
    const s = await preparar(avisar);
    avisar('Rellenando…', 0.6);
    const imagen = new Float32Array(3 * N * N), m = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) {
      imagen[i] = rgb[i * 3] / 255; imagen[N * N + i] = rgb[i * 3 + 1] / 255; imagen[2 * N * N + i] = rgb[i * 3 + 2] / 255;
      m[i] = mask[i] > 127 ? 1 : 0;
    }
    const salida = await s.run({
      image: new ort.Tensor('float32', imagen, [1, 3, N, N]),
      mask: new ort.Tensor('float32', m, [1, 1, N, N]),
    });
    const o = salida[Object.keys(salida)[0]].data; // 0-255, CHW
    const out = new Uint8Array(N * N * 3);
    for (let i = 0; i < N * N; i++) {
      for (let c = 0; c < 3; c++) { const v = o[c * N * N + i]; out[i * 3 + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
    }
    self.postMessage({ id, tipo: 'ok', res: { rgb: out } }, [out.buffer]);
  } catch (err) {
    self.postMessage({ id, tipo: 'error', msg: (err && err.message) || 'No se pudo ejecutar el relleno de precisión' });
  }
};
