import { gaussianBlur } from './core';
import { resizeLanczos } from './upscale';

// Lazo magnético (tijeras inteligentes) SIN IA:
//  1. Se mide qué tan fuerte es el borde en cada píxel (gradiente de color).
//  2. Entre dos puntos que pone el usuario se busca el camino de menor "costo" (Dijkstra), donde cuesta poco
//     pasar por bordes fuertes y mucho por zonas planas. Así la línea se pega sola a la silueta.

export function prepararLazo(img) {
  const { width: W, height: H, data } = img;
  const s = Math.min(1, 1400 / Math.max(W, H));
  const w = Math.max(8, Math.round(W * s)), h = Math.max(8, Math.round(H * s));
  const peq = s < 1 ? resizeLanczos(img, w, h) : img;
  const n = w * h;
  const canales = [0, 1, 2].map((c) => {
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = peq.data[i * 4 + c];
    return gaussianBlur(f, w, h, 0.9);
  });
  const g = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    let suma = 0;
    for (let c = 0; c < 3; c++) {
      const f = canales[c];
      const gx = (f[i - w + 1] + 2 * f[i + 1] + f[i + w + 1]) - (f[i - w - 1] + 2 * f[i - 1] + f[i + w - 1]);
      const gy = (f[i + w - 1] + 2 * f[i + w] + f[i + w + 1]) - (f[i - w - 1] + 2 * f[i - w] + f[i - w + 1]);
      suma += gx * gx + gy * gy;
    }
    g[i] = Math.sqrt(suma);
  }
  // Se normaliza con el percentil 95 de los bordes (para que el costo no dependa del contraste general).
  const muestra = [];
  for (let i = 0; i < n; i += 7) muestra.push(g[i]);
  muestra.sort((a, b) => a - b);
  const p95 = Math.max(30, muestra[Math.floor(muestra.length * 0.95)] || 1);
  const costo = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = Math.min(1, g[i] / p95); costo[i] = 0.03 + (1 - t) * (1 - t); }
  return { s, w, h, costo };
}

// Lleva un punto (px de la imagen) al borde más fuerte dentro de `radio` px de pantalla/imagen.
export function ajustarPunto(prep, x, y, radio = 8) {
  const { s, w, h, costo } = prep;
  const cx = Math.round(x * s), cy = Math.round(y * s), r = Math.max(1, Math.round(radio * s));
  let mejor = Infinity, bx = cx, by = cy;
  for (let yy = Math.max(0, cy - r); yy <= Math.min(h - 1, cy + r); yy++) for (let xx = Math.max(0, cx - r); xx <= Math.min(w - 1, cx + r); xx++) {
    const dd = Math.hypot(xx - cx, yy - cy);
    if (dd > r) continue;
    const v = costo[yy * w + xx] + dd * 0.01 / r;
    if (v < mejor) { mejor = v; bx = xx; by = yy; }
  }
  return [(bx + 0.5) / s, (by + 0.5) / s];
}

// Camino de menor costo entre (ax,ay) y (bx,by), en píxeles de la imagen original. Devuelve [[x,y], …].
export function trazarLazo(prep, ax, ay, bx, by) {
  const { s, w, h, costo } = prep;
  const cl = (v, m) => Math.max(0, Math.min(m - 1, v));
  const sx = cl(Math.round(ax * s), w), sy = cl(Math.round(ay * s), h), tx = cl(Math.round(bx * s), w), ty = cl(Math.round(by * s), h);
  const dist = Math.hypot(tx - sx, ty - sy);
  const M = Math.round(24 + dist * 0.5);
  const x0 = cl(Math.min(sx, tx) - M, w), x1 = cl(Math.max(sx, tx) + M, w), y0 = cl(Math.min(sy, ty) - M, h), y1 = cl(Math.max(sy, ty) + M, h);
  const ww = x1 - x0 + 1, wh = y1 - y0 + 1, n = ww * wh;
  const d = new Float32Array(n).fill(Infinity), padre = new Int32Array(n).fill(-1), listo = new Uint8Array(n);
  const hp = [], hv = []; // montículo binario (lazy): nodos y prioridades
  const empujar = (nodo, v) => {
    let i = hp.length; hp.push(nodo); hv.push(v);
    while (i > 0) { const p = (i - 1) >> 1; if (hv[p] <= v) break; hp[i] = hp[p]; hv[i] = hv[p]; i = p; }
    hp[i] = nodo; hv[i] = v;
  };
  const sacar = () => {
    const top = hp[0], ult = hp.pop(), vu = hv.pop();
    if (hp.length) {
      let i = 0; const m = hp.length;
      for (;;) {
        let c = 2 * i + 1; if (c >= m) break;
        if (c + 1 < m && hv[c + 1] < hv[c]) c++;
        if (hv[c] >= vu) break;
        hp[i] = hp[c]; hv[i] = hv[c]; i = c;
      }
      hp[i] = ult; hv[i] = vu;
    }
    return top;
  };
  const ini = (sy - y0) * ww + (sx - x0), fin = (ty - y0) * ww + (tx - x0);
  d[ini] = 0; empujar(ini, 0);
  while (hp.length) {
    const u = sacar();
    if (listo[u]) continue;
    listo[u] = 1;
    if (u === fin) break;
    const ux = u % ww, uy = (u / ww) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const vx = ux + dx, vy = uy + dy;
      if (vx < 0 || vy < 0 || vx >= ww || vy >= wh) continue;
      const v = vy * ww + vx;
      if (listo[v]) continue;
      const paso = (dx && dy ? 1.4142 : 1) * costo[(vy + y0) * w + vx + x0];
      const nd = d[u] + paso;
      if (nd < d[v]) { d[v] = nd; padre[v] = u; empujar(v, nd); }
    }
  }
  const pts = [];
  for (let u = fin; u !== -1; u = padre[u]) {
    pts.push([((u % ww) + x0 + 0.5) / s, (((u / ww) | 0) + y0 + 0.5) / s]);
    if (u === ini) break;
  }
  pts.reverse();
  if (pts.length) { pts[0] = [ax, ay]; pts[pts.length - 1] = [bx, by]; }
  return pts;
}
