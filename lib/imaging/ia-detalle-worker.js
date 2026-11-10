// Reconstrucción de detalle para "Mejorar calidad": Real-ESRGAN general x4v3 (BSD-3, 4.6 MB) con onnxruntime-web.
// El modelo agranda 4× y se aplica por mosaicos con traslape, así que funciona con imágenes grandes sin agotar
// la memoria. El archivo del modelo se sirve desde la propia app (public/models) y corre en el equipo.
// Se intenta primero con la tarjeta gráfica (WebGPU, mucho más rápido) y, si no existe o falla, con el procesador.
const MODELO = '/models/realesr-general-x4v3.onnx';
const T = 160; // lado del mosaico de entrada
const O = 16; // traslape (contexto) a cada lado
const S = T - 2 * O; // parte útil de cada mosaico

const PROVEEDORES = [
  ...(typeof navigator !== 'undefined' && navigator.gpu ? [{ nombre: 'gpu', motor: '/vendor/ia/ort.webgpu.min.mjs', ep: ['webgpu'] }] : []),
  { nombre: 'cpu', motor: '/vendor/ia/ort.wasm.min.mjs', ep: ['wasm'] },
];
let modeloBytes = null;
const sesiones = new Map(); // nombre → { ort, sesion }

async function preparar(p) {
  if (sesiones.has(p.nombre)) return sesiones.get(p.nombre);
  const ort = await import(/* webpackIgnore: true */ p.motor);
  ort.env.wasm.wasmPaths = '/vendor/ia/';
  ort.env.wasm.numThreads = 1;
  if (!modeloBytes) {
    const resp = await fetch(MODELO);
    if (!resp.ok) throw new Error('No se pudo cargar el componente de mejora de detalle.');
    modeloBytes = new Uint8Array(await resp.arrayBuffer());
  }
  const sesion = await ort.InferenceSession.create(modeloBytes, { executionProviders: p.ep });
  const r = { ort, sesion };
  sesiones.set(p.nombre, r);
  return r;
}

// Índice con espejo en los bordes (para que los mosaicos del borde tengan contexto).
function espejo(i, n) {
  if (n === 1) return 0;
  const p = 2 * (n - 1);
  let k = ((i % p) + p) % p;
  if (k >= n) k = p - k;
  return k;
}

async function procesar({ ort, sesion }, rgb, w, h, avisar) {
  const W4 = w * 4, H4 = h * 4;
  const out = new Uint8Array(W4 * H4 * 3);
  const columnas = Math.ceil(w / S), filas = Math.ceil(h / S), total = columnas * filas;
  const xs = new Int32Array(T), entrada = new Float32Array(3 * T * T);
  let hecho = 0;
  for (let cy = 0; cy < h; cy += S) {
    for (let cx = 0; cx < w; cx += S) {
      for (let tx = 0; tx < T; tx++) xs[tx] = espejo(cx - O + tx, w);
      for (let ty = 0; ty < T; ty++) {
        const fila = espejo(cy - O + ty, h) * w;
        for (let tx = 0; tx < T; tx++) {
          const i = (fila + xs[tx]) * 3, o = ty * T + tx;
          entrada[o] = rgb[i] / 255; entrada[T * T + o] = rgb[i + 1] / 255; entrada[2 * T * T + o] = rgb[i + 2] / 255;
        }
      }
      const salida = await sesion.run({ [sesion.inputNames[0]]: new ort.Tensor('float32', entrada, [1, 3, T, T]) });
      const tensor = salida[sesion.outputNames[0]];
      const d = tensor.data, T4 = T * 4, plano = T4 * T4;
      const cw = Math.min(S, w - cx), ch = Math.min(S, h - cy);
      for (let oy = 0; oy < ch * 4; oy++) {
        const src = (O * 4 + oy) * T4 + O * 4, dst = ((cy * 4 + oy) * W4 + cx * 4) * 3;
        for (let ox = 0; ox < cw * 4; ox++) {
          for (let c = 0; c < 3; c++) {
            const v = d[c * plano + src + ox];
            out[dst + ox * 3 + c] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0;
          }
        }
      }
      if (tensor.dispose) tensor.dispose();
      hecho++;
      avisar('Reconstruyendo detalle…', 0.05 + 0.9 * (hecho / total));
    }
  }
  return out;
}

self.onmessage = async (e) => {
  const { id, rgb, width: w, height: h } = e.data;
  const avisar = (msg, p) => self.postMessage({ id, tipo: 'progreso', msg, p });
  let ultimoError = null;
  for (const p of PROVEEDORES) {
    try {
      avisar('Preparando…', 0.02);
      const motor = await preparar(p);
      const t0 = Date.now();
      const out = await procesar(motor, rgb, w, h, avisar);
      console.info(`[detalle] ${p.nombre}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      self.postMessage({ id, tipo: 'ok', res: { rgb: out, width: w * 4, height: h * 4 } }, [out.buffer]);
      return;
    } catch (err) {
      ultimoError = err;
      console.info(`[detalle] ${p.nombre} falló, se prueba otro modo:`, err && err.message);
      sesiones.delete(p.nombre);
    }
  }
  self.postMessage({ id, tipo: 'error', msg: (ultimoError && ultimoError.message) || 'No se pudo mejorar el detalle de la imagen' });
};
