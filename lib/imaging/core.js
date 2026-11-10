// Utilidades de píxeles compartidas. Todo trabaja sobre objetos { data: Uint8ClampedArray (RGBA), width, height },
// compatibles con ImageData, para poder correr en un Web Worker sin DOM.

export function makeImage(width, height) {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

export function cloneImage(img) {
  return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
}

// sRGB (0-255) → CIE Lab, para medir "qué tan distintos se ven" dos colores.
const lin = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  lin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function f(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }

export function rgbToLab(r, g, b, out, o = 0) {
  const R = lin[r], G = lin[g], B = lin[b];
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const fx = f(x), fy = f(y), fz = f(z);
  out[o] = 116 * fy - 16;
  out[o + 1] = 500 * (fx - fy);
  out[o + 2] = 200 * (fy - fz);
}

// Lab de toda la imagen (3 floats por píxel).
export function imageToLab(img) {
  const n = img.width * img.height;
  const lab = new Float32Array(n * 3);
  const d = img.data;
  for (let i = 0; i < n; i++) rgbToLab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2], lab, i * 3);
  return lab;
}

// Desenfoque gaussiano separable sobre un canal Float32 (w × h). Devuelve uno nuevo.
export function gaussianBlur(src, w, h, sigma) {
  if (sigma <= 0) return Float32Array.from(src);
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) {
        let xx = x + i; if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1;
        a += src[row + xx] * k[i + r];
      }
      tmp[row + x] = a;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) {
        let yy = y + i; if (yy < 0) yy = 0; else if (yy >= h) yy = h - 1;
        a += tmp[yy * w + x] * k[i + r];
      }
      out[y * w + x] = a;
    }
  }
  return out;
}

// Erosión (dir < 0) o dilatación (dir > 0) de una máscara Uint8 0-255, `px` píxeles (disco aproximado).
export function morph(mask, w, h, px, dir) {
  let cur = mask;
  for (let it = 0; it < px; it++) {
    const next = new Uint8Array(cur.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let v = cur[i];
        const l = x > 0 ? cur[i - 1] : cur[i];
        const r = x < w - 1 ? cur[i + 1] : cur[i];
        const u = y > 0 ? cur[i - w] : cur[i];
        const d = y < h - 1 ? cur[i + w] : cur[i];
        v = dir > 0 ? Math.max(v, l, r, u, d) : Math.min(v, l, r, u, d);
        next[i] = v;
      }
    }
    cur = next;
  }
  return cur;
}
