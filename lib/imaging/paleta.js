import { rgbToLab } from './core';

// Paleta de colores determinista (siempre da lo mismo para la misma imagen):
//  1. Se cuentan los colores en un histograma de 5 bits por canal.
//  2. Se eligen los más frecuentes que sean claramente distintos entre sí (distancia en Lab).
//  3. K-means ponderado los afina.
//  4. En gráficos planos, cada color se "ajusta" al valor exacto más frecuente de su grupo, así el morado del
//     logo sale #7C07A6 y no un promedio con los bordes suavizados.

const hex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

export function extraerPaleta(img, n, { exacta = true } = {}) {
  const { width: w, height: h, data } = img;
  const salto = Math.max(1, Math.floor(Math.sqrt((w * h) / 400000)));
  const mapa = new Map();
  for (let y = 0; y < h; y += salto) {
    for (let x = 0; x < w; x += salto) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < 128) continue;
      const k = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
      let e = mapa.get(k);
      if (!e) { e = { n: 0, r: 0, g: 0, b: 0, ex: new Map() }; mapa.set(k, e); }
      e.n++; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2];
      const kx = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      e.ex.set(kx, (e.ex.get(kx) || 0) + 1);
    }
  }
  const bins = [...mapa.values()].map((e) => {
    const c = [e.r / e.n, e.g / e.n, e.b / e.n], lab = [0, 0, 0];
    rgbToLab(Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), lab, 0);
    let mejor = 0, cm = 0;
    for (const [kx, cnt] of e.ex) if (cnt > cm) { cm = cnt; mejor = kx; }
    return { n: e.n, c, lab, moda: [(mejor >> 16) & 255, (mejor >> 8) & 255, mejor & 255] };
  }).sort((a, b) => b.n - a.n);
  if (!bins.length) return ['#000000'];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // Semillas: los más frecuentes que no se parezcan a uno ya elegido (se relaja el umbral si faltan).
  let semillas = [];
  for (const umbral of [18, 12, 8, 5, 3, 0]) {
    semillas = [];
    for (const b of bins) {
      if (semillas.length >= n) break;
      if (semillas.every((s) => dist(s.lab, b.lab) >= umbral)) semillas.push(b);
    }
    if (semillas.length >= Math.min(n, bins.length)) break;
  }
  let cen = semillas.map((s) => s.lab.slice());

  // K-means ponderado sobre los bins.
  let asign = new Int32Array(bins.length);
  for (let it = 0; it < 8; it++) {
    const suma = cen.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < bins.length; i++) {
      let mj = 0, md = Infinity;
      for (let c = 0; c < cen.length; c++) { const d = dist(cen[c], bins[i].lab); if (d < md) { md = d; mj = c; } }
      asign[i] = mj;
      const s = suma[mj], b = bins[i];
      s[0] += b.lab[0] * b.n; s[1] += b.lab[1] * b.n; s[2] += b.lab[2] * b.n; s[3] += b.n;
    }
    cen = cen.map((c, k) => (suma[k][3] ? [suma[k][0] / suma[k][3], suma[k][1] / suma[k][3], suma[k][2] / suma[k][3]] : c));
  }

  // Color final de cada grupo: el valor exacto más frecuente (gráficos) o el promedio real (fotos).
  const salida = [];
  for (let c = 0; c < cen.length; c++) {
    let total = 0, sr = 0, sg = 0, sb = 0, top = null;
    for (let i = 0; i < bins.length; i++) {
      if (asign[i] !== c) continue;
      const b = bins[i];
      total += b.n; sr += b.c[0] * b.n; sg += b.c[1] * b.n; sb += b.c[2] * b.n;
      if (!top || b.n > top.n) top = b;
    }
    if (!total) continue;
    salida.push({ n: total, c: exacta && top && top.n / total > 0.3 ? top.moda : [sr / total, sg / total, sb / total] });
  }
  salida.sort((a, b) => b.n - a.n);
  // Gráficos planos: se descartan los colores poco frecuentes que son solo una mezcla de otros dos (el borde
  // suavizado entre dos colores), porque generarían una capa de contorno que no existe en el diseño.
  if (exacta && salida.length > 2) {
    const totalPx = salida.reduce((s, e) => s + e.n, 0);
    const labs = salida.map((e) => { const l = [0, 0, 0]; rgbToLab(Math.round(e.c[0]), Math.round(e.c[1]), Math.round(e.c[2]), l, 0); return l; });
    const quitar = new Set();
    for (let k = 2; k < salida.length; k++) {
      if (salida[k].n / totalPx > 0.03) continue;
      for (let i = 0; i < k && !quitar.has(k); i++) for (let j = i + 1; j < k; j++) {
        if (quitar.has(i) || quitar.has(j)) continue;
        const A = labs[i], B = labs[j], P = labs[k];
        const v = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [P[0] - A[0], P[1] - A[1], P[2] - A[2]];
        const len2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
        if (len2 < 400) continue; // A y B demasiado parecidos para ser "extremos"
        const t = Math.max(0, Math.min(1, (w[0] * v[0] + w[1] * v[1] + w[2] * v[2]) / len2));
        if (Math.hypot(w[0] - t * v[0], w[1] - t * v[1], w[2] - t * v[2]) < 14) { quitar.add(k); break; }
      }
    }
    for (let k = salida.length - 1; k >= 0; k--) if (quitar.has(k)) salida.splice(k, 1);
  }
  const unicos = [];
  for (const s of salida) { const h2 = hex(s.c); if (!unicos.includes(h2)) unicos.push(h2); }
  return unicos;
}
