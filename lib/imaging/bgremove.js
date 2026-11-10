import { imageToLab, rgbToLab, gaussianBlur, morph } from './core';

// Quitar fondo SIN IA: se decide qué es "fondo" comparando colores (distancia perceptual en Lab).
//  - modo 'bordes': toma los colores dominantes del contorno de la imagen y "inunda" desde ahí.
//  - modo 'color' : quita el color que eliges (en toda la imagen o solo la zona conectada al clic).
// Después suaviza el borde y le quita al contorno el tinte del fondo (defringe).

const dE = (L, i, c) => {
  const a = L[i] - c[0], b = L[i + 1] - c[1], d = L[i + 2] - c[2];
  return Math.sqrt(a * a + b * b + d * d);
};

function coloresDeBorde(img, lab) {
  const { width: w, height: h } = img;
  const centros = []; // { c:[L,a,b], n }
  const probar = (x, y) => {
    const i = (y * w + x) * 3;
    for (const k of centros) {
      const a = lab[i] - k.c[0], b = lab[i + 1] - k.c[1], d = lab[i + 2] - k.c[2];
      if (Math.sqrt(a * a + b * b + d * d) < 12) { k.n++; return; }
    }
    if (centros.length < 12) centros.push({ c: [lab[i], lab[i + 1], lab[i + 2]], n: 1 });
  };
  for (let x = 0; x < w; x++) { probar(x, 0); probar(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { probar(0, y); probar(w - 1, y); }
  const total = centros.reduce((s, k) => s + k.n, 0);
  centros.sort((a, b) => b.n - a.n);
  const buenos = centros.filter((k, idx) => idx === 0 || k.n / total >= 0.1).slice(0, 4);
  return buenos.map((k) => k.c);
}

// Distancia de cada píxel al color de fondo más cercano.
function distancias(lab, n, centros) {
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 1e9;
    for (const c of centros) { const v = dE(lab, i * 3, c); if (v < m) m = v; }
    dist[i] = m;
  }
  return dist;
}

export function quitarFondo(img, o = {}) {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const T = Math.max(1, (o.tolerancia ?? 20) * 0.7); // ΔE
  const lab = imageToLab(img);

  let centros;
  if (o.modo === 'color' && o.color) {
    const c = [0, 0, 0];
    rgbToLab(o.color[0], o.color[1], o.color[2], c);
    centros = [c];
  } else {
    centros = coloresDeBorde(img, lab);
  }
  const dist = distancias(lab, n, centros);

  // Zonas ya transparentes en el original cuentan como fondo.
  const esFondoBase = (i) => data[i * 4 + 3] < 8;

  const bg = new Uint8Array(n); // 255 = fondo
  const cola = new Int32Array(n);
  let qh = 0, qt = 0;
  const empuja = (i) => { if (!bg[i]) { bg[i] = 255; cola[qt++] = i; } };
  const limite = o.degradado ? T * 0.5 : T;

  const global = o.modo === 'color' && !o.conectado;
  if (global) {
    for (let i = 0; i < n; i++) if (dist[i] <= T || esFondoBase(i)) bg[i] = 255;
  } else {
    if (o.modo === 'color' && o.semilla) {
      const sx = Math.max(0, Math.min(w - 1, o.semilla.x | 0)), sy = Math.max(0, Math.min(h - 1, o.semilla.y | 0));
      empuja(sy * w + sx);
    } else {
      const sembrar = (x, y) => { const i = y * w + x; if (dist[i] <= T || esFondoBase(i)) empuja(i); };
      for (let x = 0; x < w; x++) { sembrar(x, 0); sembrar(x, h - 1); }
      for (let y = 1; y < h - 1; y++) { sembrar(0, y); sembrar(w - 1, y); }
    }
    while (qh < qt) {
      const i = cola[qh++];
      const x = i % w, y = (i / w) | 0;
      const vecinos = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of vecinos) {
        if (j < 0 || bg[j]) continue;
        if (esFondoBase(j)) { empuja(j); continue; }
        if (o.degradado && o.modo !== 'color') {
          // Fondo con degradado: compara contra el vecino, no contra un color fijo.
          const a = lab[i * 3] - lab[j * 3], b = lab[i * 3 + 1] - lab[j * 3 + 1], d = lab[i * 3 + 2] - lab[j * 3 + 2];
          if (Math.sqrt(a * a + b * b + d * d) <= limite) empuja(j);
        } else if (dist[j] <= T) empuja(j);
      }
    }
    // Zonas interiores (el hueco de una "O", etc.): mismo color de fondo pero sin conexión con el borde.
    if (o.interior) for (let i = 0; i < n; i++) if (!bg[i] && dist[i] <= T * 0.8) bg[i] = 255;
  }

  // Alfa: 0 en fondo, 255 en objeto; los píxeles de objeto pegados al fondo reciben una rampa
  // según qué tan parecidos son al fondo (bordes suavizados / antialias).
  const alfa = new Float32Array(n);
  for (let i = 0; i < n; i++) alfa[i] = bg[i] ? 0 : 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (bg[i]) continue;
      const toca = (x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (y > 0 && bg[i - w]) || (y < h - 1 && bg[i + w]);
      if (!toca) continue;
      const r = (dist[i] - T * 0.5) / (T * 1.2);
      alfa[i] = 255 * Math.max(0, Math.min(1, r));
    }
  }
  const suav = [0, 0.6, 1.0, 1.5, 2.2][Math.max(0, Math.min(4, o.suavizado ?? 1))];
  let a = suav > 0 ? gaussianBlur(alfa, w, h, suav) : alfa;
  let a8 = new Uint8Array(n);
  for (let i = 0; i < n; i++) a8[i] = Math.max(0, Math.min(255, a[i] + 0.5));
  if (o.contraer > 0) a8 = morph(a8, w, h, o.contraer, -1);
  else if (o.contraer < 0) a8 = morph(a8, w, h, -o.contraer, 1);

  return componerResultado(img, a8, true);
}

// Aplica el alfa a la imagen. Con `defringe` reemplaza el color de los píxeles semitransparentes
// por el de los píxeles sólidos cercanos, que elimina el halo del color del fondo.
export function componerResultado(img, alfa, defringe = true) {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(data);
  const RAD = 3;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const av = alfa[i];
      if (defringe && av > 0 && av < 255) {
        let r = 0, g = 0, b = 0, ws = 0;
        for (let dy = -RAD; dy <= RAD; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (let dx = -RAD; dx <= RAD; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= w) continue;
            const j = yy * w + xx;
            if (alfa[j] < 250) continue;
            const wt = 1 / (1 + dx * dx + dy * dy);
            r += data[j * 4] * wt; g += data[j * 4 + 1] * wt; b += data[j * 4 + 2] * wt; ws += wt;
          }
        }
        if (ws > 0) { out[i * 4] = r / ws; out[i * 4 + 1] = g / ws; out[i * 4 + 2] = b / ws; }
      }
      out[i * 4 + 3] = Math.round((av * data[i * 4 + 3]) / 255);
    }
  }
  return { data: out, width: w, height: h, alfa };
}

// Caja que contiene todo lo no transparente (para recortar espacio vacío).
export function cajaDeContenido(img, umbral = 8) {
  const { width: w, height: h, data } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > umbral) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
