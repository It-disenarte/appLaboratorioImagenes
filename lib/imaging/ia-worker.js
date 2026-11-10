// Recorte de precisión: un modelo de segmentación (BiRefNet lite, licencia MIT) que corre dentro del navegador.
// Se descarga una sola vez (queda en la caché del navegador) y las imágenes nunca salen del equipo.
// La librería se sirve como archivo estático (public/vendor/ia, copiado por scripts/copiar-ia.js) y se carga sin
// pasar por webpack: el minificador de Next no puede procesar el bundle de onnxruntime-web.
let AutoModel, AutoProcessor, RawImage;
const preparar = (async () => {
  const lib = await import(/* webpackIgnore: true */ '/vendor/ia/transformers.min.js');
  ({ AutoModel, AutoProcessor, RawImage } = lib);
  lib.env.allowLocalModels = false;
  lib.env.useBrowserCache = true;
  lib.env.backends.onnx.wasm.wasmPaths = '/vendor/ia/';
})();

const MODELO = 'onnx-community/BiRefNet_512x512-ONNX';
// Primero la tarjeta gráfica (rápido) y, si falla o no existe, el procesador (funciona en cualquier equipo).
const DISPOSITIVOS = [
  ...(typeof navigator !== 'undefined' && navigator.gpu && !self.name.includes('sin-gpu') ? [{ device: 'webgpu', dtype: 'fp16' }] : []),
  { device: 'wasm', dtype: 'fp32' },
];
let paso = 0; // índice del dispositivo en uso
let cargado = null;
const archivos = new Map();

async function cargar(avisar) {
  await preparar;
  if (cargado) return cargado;
  const progreso = (p) => {
    if (p.status === 'progress' && p.total) {
      archivos.set(p.file, [p.loaded, p.total]);
      let l = 0, t = 0;
      for (const [a, b] of archivos.values()) { l += a; t += b; }
      avisar('Preparando el recorte de precisión (solo la primera vez)…', 0.05 + 0.5 * (l / t));
    }
  };
  cargado = (async () => {
    const [model, processor] = await Promise.all([
      AutoModel.from_pretrained(MODELO, { ...DISPOSITIVOS[paso], progress_callback: progreso }),
      AutoProcessor.from_pretrained(MODELO),
    ]);
    return { model, processor };
  })();
  try { return await cargado; } catch (e) { cargado = null; throw e; }
}

async function correr(rgb, width, height, avisar) {
  const { model, processor } = await cargar(avisar);
  avisar('Buscando el sujeto…', 0.6);
  const imagen = new RawImage(new Uint8ClampedArray(rgb), width, height, 3);
  const { pixel_values } = await processor(imagen);
  const { output_image } = await model({ input_image: pixel_values });
  const mascara = RawImage.fromTensor(output_image[0].sigmoid().mul(255).to('uint8'));
  return { matte: new Uint8Array(mascara.data), mw: mascara.width, mh: mascara.height };
}

self.onmessage = async (e) => {
  const { id, rgb, width, height } = e.data;
  const avisar = (msg, p) => self.postMessage({ id, tipo: 'progreso', msg, p });
  for (;;) {
    try {
      const r = await correr(rgb, width, height, avisar);
      self.postMessage({ id, tipo: 'ok', res: r }, [r.matte.buffer]);
      return;
    } catch (err) {
      if (paso < DISPOSITIVOS.length - 1) { paso++; cargado = null; avisar('Ajustando el modo de proceso…', 0.5); continue; }
      self.postMessage({ id, tipo: 'error', msg: (err && err.message) || 'No se pudo ejecutar el recorte de precisión' });
      return;
    }
  }
};
