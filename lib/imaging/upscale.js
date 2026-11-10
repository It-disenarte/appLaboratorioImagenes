import { makeImage, gaussianBlur } from './core';

// ---- Reescalado Lanczos-3 (separable, con alfa premultiplicado) ----

function lanczos(x) {
  if (x === 0) return 1;
  if (x <= -3 || x >= 3) return 0;
  const px = Math.PI * x;
  return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
}

// Pesos por cada píxel de salida: [inicio, pesos...]
function buildWeights(srcLen, dstLen) {
  const scale = dstLen / srcLen;
  const filterScale = Math.max(1, 1 / scale); // al reducir, ensancha el filtro para no hacer alias
  const support = 3 * filterScale;
  const out = new Array(dstLen);
  for (let i = 0; i < dstLen; i++) {
    const center = (i + 0.5) / scale - 0.5;
    const start = Math.max(0, Math.floor(center - support) + 1);
    const end = Math.min(srcLen - 1, Math.ceil(center + support) - 1);
    const w = [];
    let sum = 0;
    for (let j = start; j <= end; j++) { const v = lanczos((j - center) / filterScale); w.push(v); sum += v; }
    for (let k = 0; k < w.length; k++) w[k] /= sum || 1;
    out[i] = { start, w };
  }
  return out;
}

export function resizeLanczos(src, nw, nh) {
  const { width: sw, height: sh, data } = src;
  // Premultiplicar alfa para que los bordes transparentes no "sangren" color.
  const tmp = new Float32Array(nw * sh * 4);
  const wx = buildWeights(sw, nw);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < nw; x++) {
      const { start, w } = wx[x];
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < w.length; k++) {
        const p = (y * sw + start + k) * 4;
        const al = data[p + 3] / 255;
        r += data[p] * al * w[k]; g += data[p + 1] * al * w[k]; b += data[p + 2] * al * w[k]; a += al * w[k];
      }
      const o = (y * nw + x) * 4;
      tmp[o] = r; tmp[o + 1] = g; tmp[o + 2] = b; tmp[o + 3] = a;
    }
  }
  const out = makeImage(nw, nh);
  const wy = buildWeights(sh, nh);
  for (let y = 0; y < nh; y++) {
    const { start, w } = wy[y];
    for (let x = 0; x < nw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < w.length; k++) {
        const p = ((start + k) * nw + x) * 4;
        r += tmp[p] * w[k]; g += tmp[p + 1] * w[k]; b += tmp[p + 2] * w[k]; a += tmp[p + 3] * w[k];
      }
      const o = (y * nw + x) * 4;
      if (a > 0.0001) {
        out.data[o] = r / a; out.data[o + 1] = g / a; out.data[o + 2] = b / a;
        out.data[o + 3] = Math.min(1, a) * 255;
      }
    }
  }
  return out;
}

// ---- Filtro bilateral: quita ruido y "cuadritos" de JPG sin borrar los bordes ----
export function bilateral(img, radius, sigmaColor) {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(data.length);
  const sigmaSpace = Math.max(1, radius / 2);
  const inv2c = 1 / (2 * sigmaColor * sigmaColor), inv2s = 1 / (2 * sigmaSpace * sigmaSpace);
  const sp = [];
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) sp.push([dx, dy, Math.exp(-(dx * dx + dy * dy) * inv2s)]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let r = 0, g = 0, b = 0, ws = 0;
      const cr = data[i], cg = data[i + 1], cb = data[i + 2];
      for (let k = 0; k < sp.length; k++) {
        const xx = x + sp[k][0], yy = y + sp[k][1];
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = (yy * w + xx) * 4;
        const dr = data[j] - cr, dg = data[j + 1] - cg, db = data[j + 2] - cb;
        const wt = sp[k][2] * Math.exp(-(dr * dr + dg * dg + db * db) * inv2c);
        r += data[j] * wt; g += data[j + 1] * wt; b += data[j + 2] * wt; ws += wt;
      }
      out[i] = r / ws; out[i + 1] = g / ws; out[i + 2] = b / ws; out[i + 3] = data[i + 3];
    }
  }
  return { data: out, width: w, height: h };
}

// ---- Máscara de enfoque (unsharp) sobre la luminosidad, para no crear halos de color ----
export function unsharp(img, amount, sigma, threshold = 2) {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  const blur = gaussianBlur(lum, w, h, sigma);
  const out = new Uint8ClampedArray(data);
  for (let i = 0; i < n; i++) {
    let d = lum[i] - blur[i];
    if (Math.abs(d) < threshold) continue;
    d *= amount;
    // Limita el realce para evitar halos fuertes en bordes muy contrastados.
    if (d > 60) d = 60; else if (d < -60) d = -60;
    out[i * 4] += d; out[i * 4 + 1] += d; out[i * 4 + 2] += d;
  }
  return { data: out, width: w, height: h };
}

// ---- Mejora de calidad completa ----
// opciones: { factor 1-4, nitidez 0-100, limpiar 0-100 (quitar ruido/JPG) }
export function mejorarCalidad(img, { factor = 2, nitidez = 50, limpiar = 30 }, progreso = () => {}) {
  let cur = img;
  if (limpiar > 0) {
    progreso('Limpiando ruido…', 0.05);
    const r = limpiar > 60 ? 3 : 2;
    cur = bilateral(cur, r, 10 + limpiar * 0.45);
  }
  // Escala en pasos de hasta 2×: cada paso se enfoca un poco, lo que conserva mejor los bordes.
  const pasos = [];
  let restante = factor;
  while (restante > 1.0001) { const s = Math.min(2, restante); pasos.push(s); restante /= s; }
  const am = nitidez / 100;
  pasos.forEach((s, idx) => {
    progreso('Aumentando tamaño…', 0.2 + (0.6 * idx) / pasos.length);
    const nw = Math.round(cur.width * s), nh = Math.round(cur.height * s);
    cur = resizeLanczos(cur, nw, nh);
    if (am > 0) cur = unsharp(cur, 0.5 + am * 1.1, 0.8 + s * 0.35, 3);
  });
  if (!pasos.length && am > 0) cur = unsharp(cur, 0.5 + am * 1.1, 1.0, 3);
  progreso('Listo', 1);
  return cur;
}
