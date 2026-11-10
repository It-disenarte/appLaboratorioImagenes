// Puente entre la pantalla y el Web Worker, más utilidades de lienzo.
import { morph, gaussianBlur } from './core';

let worker = null;
let seq = 0;
const pendientes = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./worker.js', import.meta.url));
    worker.onmessage = (e) => {
      const { id, tipo } = e.data;
      const p = pendientes.get(id);
      if (!p) return;
      if (tipo === 'progreso') { p.onProgress && p.onProgress(e.data.msg, e.data.p); return; }
      pendientes.delete(id);
      if (tipo === 'ok') p.resolve(e.data.res); else p.reject(new Error(e.data.msg));
    };
    worker.onerror = (ev) => {
      for (const p of pendientes.values()) p.reject(new Error(ev.message || 'Error en el procesamiento'));
      pendientes.clear();
      worker = null;
    };
  }
  return worker;
}

// Ejecuta una operación. Copia los buffers (la imagen original sigue disponible en pantalla).
export function ejecutar(op, { img, mask, opts }, onProgress) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pendientes.set(id, { resolve, reject, onProgress });
    const copia = img ? { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height } : undefined;
    const m = mask ? new Uint8Array(mask) : undefined;
    const tr = [];
    if (copia) tr.push(copia.data.buffer);
    if (m) tr.push(m.buffer);
    getWorker().postMessage({ id, op, img: copia, mask: m, opts }, tr);
  });
}

// Recorte de precisión: el modelo devuelve una máscara de baja resolución y el worker de algoritmos la
// lleva a tamaño real afinándola contra los bordes de la foto.
let workerIA = null;
export async function recortePrecision(img, { suavizado = 1, contraer = 0 } = {}, onProgress) {
  let sinGpu = false;
  try { sinGpu = localStorage.getItem('sinGpu') === '1'; } catch {} // para pruebas: fuerza el modo sin tarjeta gráfica
  if (!workerIA) workerIA = new Worker(new URL('./ia-worker.js', import.meta.url), { type: 'module', name: sinGpu ? 'ia-sin-gpu' : 'ia' });
  const lado = 1024, k = Math.min(1, lado / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const orig = document.createElement('canvas'); aLienzo(img, orig);
  const peq = document.createElement('canvas'); peq.width = w; peq.height = h;
  const pctx = peq.getContext('2d', { willReadFrequently: true });
  pctx.imageSmoothingQuality = 'high'; pctx.drawImage(orig, 0, 0, w, h);
  const px = pctx.getImageData(0, 0, w, h).data, rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { rgb[i * 3] = px[i * 4]; rgb[i * 3 + 1] = px[i * 4 + 1]; rgb[i * 3 + 2] = px[i * 4 + 2]; }
  const id = ++seq;
  const r = await new Promise((resolve, reject) => {
    const alMensaje = (e) => {
      if (e.data.id !== id) return;
      if (e.data.tipo === 'progreso') { onProgress && onProgress(e.data.msg, e.data.p * 0.8); return; }
      workerIA.removeEventListener('message', alMensaje);
      if (e.data.tipo === 'ok') resolve(e.data.res); else reject(new Error(e.data.msg));
    };
    workerIA.addEventListener('message', alMensaje);
    workerIA.onerror = (ev) => { workerIA = null; reject(new Error(ev.message || 'No se pudo cargar el recorte de precisión')); };
    workerIA.postMessage({ id, rgb, width: w, height: h }, [rgb.buffer]);
  });
  return ejecutar('matte', { img, mask: r.matte, opts: { mw: r.mw, mh: r.mh, suavizado, contraer } }, (m, p) => onProgress && onProgress(m, 0.8 + p * 0.2));
}

// Mejorar calidad reconstruyendo detalle: el modelo agranda 4× por mosaicos; después se lleva al tamaño pedido
// (2×, 3× o el mismo, que sirve para limpiar y avivar sin cambiar el tamaño). La transparencia se agranda aparte.
let workerDetalle = null;
export async function mejorarConDetalle(img, { factor = 2 } = {}, onProgress) {
  const { width: w, height: h } = img;
  const rgb = new Uint8Array(w * h * 3);
  let hayAlfa = false;
  for (let i = 0; i < w * h; i++) {
    rgb[i * 3] = img.data[i * 4]; rgb[i * 3 + 1] = img.data[i * 4 + 1]; rgb[i * 3 + 2] = img.data[i * 4 + 2];
    if (img.data[i * 4 + 3] < 255) hayAlfa = true;
  }
  if (!workerDetalle) workerDetalle = new Worker(new URL('./ia-detalle-worker.js', import.meta.url), { type: 'module' });
  const id = ++seq;
  const r = await new Promise((resolve, reject) => {
    const alMensaje = (e) => {
      if (e.data.id !== id) return;
      if (e.data.tipo === 'progreso') { onProgress && onProgress(e.data.msg, e.data.p * 0.9); return; }
      workerDetalle.removeEventListener('message', alMensaje);
      if (e.data.tipo === 'ok') resolve(e.data.res); else reject(new Error(e.data.msg));
    };
    workerDetalle.addEventListener('message', alMensaje);
    workerDetalle.onerror = (ev) => { workerDetalle = null; reject(new Error(ev.message || 'No se pudo cargar la mejora de detalle')); };
    workerDetalle.postMessage({ id, rgb, width: w, height: h }, [rgb.buffer]);
  });

  const W4 = r.width, H4 = r.height, data = new Uint8ClampedArray(W4 * H4 * 4);
  for (let i = 0; i < W4 * H4; i++) { data[i * 4] = r.rgb[i * 3]; data[i * 4 + 1] = r.rgb[i * 3 + 1]; data[i * 4 + 2] = r.rgb[i * 3 + 2]; data[i * 4 + 3] = 255; }
  if (hayAlfa) {
    // Se agranda solo el canal alfa (como imagen en grises) con el suavizado del navegador.
    const a = document.createElement('canvas'); a.width = w; a.height = h;
    const ad = new ImageData(w, h);
    for (let i = 0; i < w * h; i++) { const v = img.data[i * 4 + 3]; ad.data[i * 4] = ad.data[i * 4 + 1] = ad.data[i * 4 + 2] = v; ad.data[i * 4 + 3] = 255; }
    a.getContext('2d').putImageData(ad, 0, 0);
    const g = document.createElement('canvas'); g.width = W4; g.height = H4;
    const gc = g.getContext('2d', { willReadFrequently: true });
    gc.imageSmoothingQuality = 'high'; gc.drawImage(a, 0, 0, W4, H4);
    const gd = gc.getImageData(0, 0, W4, H4).data;
    for (let i = 0; i < W4 * H4; i++) data[i * 4 + 3] = gd[i * 4];
  }
  const grande = { data, width: W4, height: H4 };
  if (factor === 4) { onProgress && onProgress('Listo', 1); return grande; }
  return ejecutar('redimensionar', { img: grande, opts: { w: Math.round(w * factor), h: Math.round(h * factor) } }, (m, p) => onProgress && onProgress('Ajustando el tamaño…', 0.9 + p * 0.1));
}

// Quitar objetos con relleno de precisión. El modelo trabaja con recortes de 512×512: se toma la zona alrededor de
// lo marcado (con contexto), se rellena y solo se pegan de vuelta los píxeles marcados, con el borde suavizado.
let workerRelleno = null;
export async function quitarObjetosPrecision(img, mask, { expandir = 2 } = {}, onProgress) {
  const N = 512, { width: W, height: H } = img;
  const m = expandir > 0 ? morph(mask, W, H, expandir, 1) : mask;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) throw new Error('Primero pinta con el pincel lo que quieres eliminar.');
  // Zona de trabajo: lo marcado más bastante contexto; mínimo 512 px para no reducir la imagen sin necesidad.
  const lado = Math.max(N, Math.round(Math.max(x1 - x0 + 1, y1 - y0 + 1) * 1.7));
  const rw = Math.min(W, lado), rh = Math.min(H, lado);
  const rx = Math.max(0, Math.min(W - rw, Math.round((x0 + x1) / 2 - rw / 2)));
  const ry = Math.max(0, Math.min(H - rh, Math.round((y0 + y1) / 2 - rh / 2)));

  const orig = document.createElement('canvas'); aLienzo(img, orig);
  const peq = document.createElement('canvas'); peq.width = N; peq.height = N;
  const pctx = peq.getContext('2d', { willReadFrequently: true });
  pctx.imageSmoothingQuality = 'high'; pctx.drawImage(orig, rx, ry, rw, rh, 0, 0, N, N);
  const px = pctx.getImageData(0, 0, N, N).data, rgb = new Uint8Array(N * N * 3), mk = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) { rgb[i * 3] = px[i * 4]; rgb[i * 3 + 1] = px[i * 4 + 1]; rgb[i * 3 + 2] = px[i * 4 + 2]; }
  for (let j = 0; j < N; j++) {
    const sy = Math.min(H - 1, ry + Math.floor(((j + 0.5) * rh) / N));
    for (let i = 0; i < N; i++) if (m[sy * W + Math.min(W - 1, rx + Math.floor(((i + 0.5) * rw) / N))]) mk[j * N + i] = 255;
  }
  const mk2 = morph(mk, N, N, 1, 1); // un píxel más, para no dejar bordes del objeto

  if (!workerRelleno) workerRelleno = new Worker(new URL('./ia-objetos-worker.js', import.meta.url), { type: 'module' });
  const id = ++seq;
  const r = await new Promise((resolve, reject) => {
    const alMensaje = (e) => {
      if (e.data.id !== id) return;
      if (e.data.tipo === 'progreso') { onProgress && onProgress(e.data.msg, e.data.p * 0.9); return; }
      workerRelleno.removeEventListener('message', alMensaje);
      if (e.data.tipo === 'ok') resolve(e.data.res); else reject(new Error(e.data.msg));
    };
    workerRelleno.addEventListener('message', alMensaje);
    workerRelleno.onerror = (ev) => { workerRelleno = null; reject(new Error(ev.message || 'No se pudo cargar el relleno de precisión')); };
    workerRelleno.postMessage({ id, rgb, mask: mk2 }, [rgb.buffer, mk2.buffer]);
  });

  // El resultado (512×512) vuelve al tamaño de la zona y se mezcla solo donde estaba la marca.
  onProgress && onProgress('Integrando el resultado…', 0.95);
  const sal = document.createElement('canvas'); sal.width = N; sal.height = N;
  const idat = new ImageData(N, N);
  for (let i = 0; i < N * N; i++) { idat.data[i * 4] = r.rgb[i * 3]; idat.data[i * 4 + 1] = r.rgb[i * 3 + 1]; idat.data[i * 4 + 2] = r.rgb[i * 3 + 2]; idat.data[i * 4 + 3] = 255; }
  sal.getContext('2d').putImageData(idat, 0, 0);
  const grande = document.createElement('canvas'); grande.width = rw; grande.height = rh;
  const gctx = grande.getContext('2d', { willReadFrequently: true });
  gctx.imageSmoothingQuality = 'high'; gctx.drawImage(sal, 0, 0, rw, rh);
  const ai = gctx.getImageData(0, 0, rw, rh).data;
  const peso = new Float32Array(rw * rh);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) peso[y * rw + x] = m[(y + ry) * W + x + rx] ? 1 : 0;
  const suave = gaussianBlur(peso, rw, rh, Math.max(1, Math.max(rw, rh) / 700));
  const out = new Uint8ClampedArray(img.data);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const a = Math.min(1, suave[y * rw + x] * 1.6);
    if (a <= 0.003) continue;
    const gi = ((y + ry) * W + x + rx) * 4, si = (y * rw + x) * 4;
    for (let c = 0; c < 3; c++) out[gi + c] = out[gi + c] * (1 - a) + ai[si + c] * a;
  }
  onProgress && onProgress('Listo', 1);
  return { data: out, width: W, height: H };
}

export function cargarArchivo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(im, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ data: d.data, width: c.width, height: c.height });
    };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen. Usa PNG, JPG, WEBP, GIF o BMP.')); };
    im.src = url;
  });
}

export function aLienzo(img, canvas) {
  canvas.width = img.width; canvas.height = img.height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return canvas;
}

export function aBlob(img, tipo = 'image/png', calidad = 0.92) {
  const c = document.createElement('canvas');
  aLienzo(img, c);
  return new Promise((resolve) => c.toBlob(resolve, tipo, calidad));
}

export function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
