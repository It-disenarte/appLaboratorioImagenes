import { morph } from './core';

// Eliminar objetos SIN IA: relleno por parches (PatchMatch + votación, al estilo "relleno según contenido").
// Se busca, en el resto de la foto, el trozo de textura que mejor encaja con lo que rodea al hueco y se
// copia ahí. Funciona de grueso a fino (pirámide) para respetar estructuras grandes y luego el detalle.

const PR = 3; // radio del parche → 7×7
const PN = (2 * PR + 1) * (2 * PR + 1);

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// Relleno rápido "por capas" desde el borde del hueco hacia adentro (base de partida, borroso).
function onionFill(rgb, hole, w, h) {
  const conocido = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) conocido[i] = hole[i] ? 0 : 1;
  let pendientes = true;
  while (pendientes) {
    pendientes = false;
    const nuevos = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (conocido[i]) continue;
        let r = 0, g = 0, b = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (!conocido[j]) continue;
          r += rgb[j * 3]; g += rgb[j * 3 + 1]; b += rgb[j * 3 + 2]; c++;
        }
        if (c) nuevos.push(i, r / c, g / c, b / c);
        else pendientes = true;
      }
    }
    if (!nuevos.length) break;
    for (let k = 0; k < nuevos.length; k += 4) {
      const i = nuevos[k]; rgb[i * 3] = nuevos[k + 1]; rgb[i * 3 + 1] = nuevos[k + 2]; rgb[i * 3 + 2] = nuevos[k + 3];
      conocido[i] = 1;
    }
  }
}

function reducir(rgb, hole, w, h) {
  const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
  const o = new Float32Array(nw * nh * 3), oh = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    let r = 0, g = 0, b = 0, c = 0, hh = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const xx = Math.min(w - 1, x * 2 + dx), yy = Math.min(h - 1, y * 2 + dy), j = yy * w + xx;
      if (hole[j]) { hh = 1; continue; }
      r += rgb[j * 3]; g += rgb[j * 3 + 1]; b += rgb[j * 3 + 2]; c++;
    }
    const i = y * nw + x;
    if (c) { o[i * 3] = r / c; o[i * 3 + 1] = g / c; o[i * 3 + 2] = b / c; }
    oh[i] = hh;
  }
  return { rgb: o, hole: oh, w: nw, h: nh };
}

// Mapa de centros de parche "fuente válidos" (parche entero fuera del hueco) y lista de centros "activos"
// (parches que tocan el hueco y hay que resolver).
function clasificar(hole, w, h) {
  const W1 = w + 1;
  const integral = new Int32Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let fila = 0;
    for (let x = 0; x < w; x++) { fila += hole[y * w + x]; integral[(y + 1) * W1 + x + 1] = integral[y * W1 + x + 1] + fila; }
  }
  const valido = new Uint8Array(w * h);
  const fuentes = [], activos = [];
  for (let y = PR; y < h - PR; y++) for (let x = PR; x < w - PR; x++) {
    const s = integral[(y + PR + 1) * W1 + x + PR + 1] - integral[(y - PR) * W1 + x + PR + 1] - integral[(y + PR + 1) * W1 + x - PR] + integral[(y - PR) * W1 + x - PR];
    const i = y * w + x;
    if (s === 0) { valido[i] = 1; fuentes.push(i); } else activos.push(i);
  }
  return { valido, fuentes, activos };
}

function costo(rgb, w, tx, ty, sx, sy, mejor) {
  let s = 0;
  for (let dy = -PR; dy <= PR; dy++) {
    let a = ((ty + dy) * w + tx - PR) * 3, b = ((sy + dy) * w + sx - PR) * 3;
    for (let dx = 0; dx <= 2 * PR; dx++, a += 3, b += 3) {
      const r = rgb[a] - rgb[b], g = rgb[a + 1] - rgb[b + 1], bl = rgb[a + 2] - rgb[b + 2];
      s += r * r + g * g + bl * bl;
    }
    if (s >= mejor) return s;
  }
  return s;
}

function patchMatch(rgb, w, h, cls, nnf, cost, pasadas, rand) {
  const { valido, fuentes, activos } = cls;
  const nAct = activos.length;
  for (let pasada = 0; pasada < pasadas; pasada++) {
    const fwd = pasada % 2 === 0;
    for (let k = 0; k < nAct; k++) {
      const p = activos[fwd ? k : nAct - 1 - k];
      const tx = p % w, ty = (p / w) | 0;
      let bs = nnf[p], bc = cost[p];
      // Propagación: el vecino ya resuelto sugiere un desplazamiento parecido.
      const vecs = fwd ? [p - 1, p - w] : [p + 1, p + w];
      const dxs = fwd ? [-1, 0] : [1, 0], dys = fwd ? [0, -1] : [0, 1];
      for (let v = 0; v < 2; v++) {
        const q = vecs[v];
        if (q < 0 || q >= w * h || nnf[q] < 0) continue;
        const nx = tx + dxs[v], ny = ty + dys[v];
        if (nx < PR || ny < PR || nx >= w - PR || ny >= h - PR) continue;
        const sq = nnf[q];
        const sx = (sq % w) - dxs[v], sy = ((sq / w) | 0) - dys[v];
        if (sx < PR || sy < PR || sx >= w - PR || sy >= h - PR) continue;
        const si = sy * w + sx;
        if (!valido[si]) continue;
        const c = costo(rgb, w, tx, ty, sx, sy, bc);
        if (c < bc) { bc = c; bs = si; }
      }
      // Búsqueda aleatoria alrededor de la mejor coincidencia, con radio decreciente.
      let rad = Math.max(w, h) >> 1;
      const bx0 = bs % w, by0 = (bs / w) | 0;
      while (rad >= 1) {
        const sx = Math.round(bx0 + (rand() * 2 - 1) * rad), sy = Math.round(by0 + (rand() * 2 - 1) * rad);
        if (sx >= PR && sy >= PR && sx < w - PR && sy < h - PR) {
          const si = sy * w + sx;
          if (valido[si]) { const c = costo(rgb, w, tx, ty, sx, sy, bc); if (c < bc) { bc = c; bs = si; } }
        }
        rad >>= 1;
      }
      nnf[p] = bs; cost[p] = bc;
    }
  }
}

// Reconstruye los píxeles del hueco promediando lo que "votan" los parches que los cubren.
function votar(rgb, hole, w, h, cls, nnf, cost) {
  const acc = new Float32Array(w * h * 3), pes = new Float32Array(w * h);
  const k = PN * 3 * 40;
  for (const p of cls.activos) {
    const s = nnf[p];
    if (s < 0) continue;
    const wt = 1 / (1 + cost[p] / k);
    const tx = p % w, ty = (p / w) | 0, sx = s % w, sy = (s / w) | 0;
    for (let dy = -PR; dy <= PR; dy++) for (let dx = -PR; dx <= PR; dx++) {
      const t = (ty + dy) * w + tx + dx;
      if (!hole[t]) continue;
      const q = ((sy + dy) * w + sx + dx) * 3;
      acc[t * 3] += rgb[q] * wt; acc[t * 3 + 1] += rgb[q + 1] * wt; acc[t * 3 + 2] += rgb[q + 2] * wt; pes[t] += wt;
    }
  }
  let cambio = 0;
  for (let i = 0; i < w * h; i++) {
    if (!hole[i] || pes[i] === 0) continue;
    for (let c = 0; c < 3; c++) { const v = acc[i * 3 + c] / pes[i]; cambio += Math.abs(v - rgb[i * 3 + c]); rgb[i * 3 + c] = v; }
  }
  return cambio;
}

function subir(rgbG, wG, hG, rgbF, holeF, wF, hF) {
  // Los píxeles del hueco del nivel fino se inicializan interpolando el resultado del nivel grueso.
  for (let y = 0; y < hF; y++) for (let x = 0; x < wF; x++) {
    const i = y * wF + x;
    if (!holeF[i]) continue;
    const fx = Math.max(0, Math.min(wG - 1, (x + 0.5) / 2 - 0.5)), fy = Math.max(0, Math.min(hG - 1, (y + 0.5) / 2 - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(wG - 1, x0 + 1), y1 = Math.min(hG - 1, y0 + 1);
    const ax = fx - x0, ay = fy - y0;
    for (let c = 0; c < 3; c++) {
      const v = (rgbG[(y0 * wG + x0) * 3 + c] * (1 - ax) + rgbG[(y0 * wG + x1) * 3 + c] * ax) * (1 - ay)
        + (rgbG[(y1 * wG + x0) * 3 + c] * (1 - ax) + rgbG[(y1 * wG + x1) * 3 + c] * ax) * ay;
      rgbF[i * 3 + c] = v;
    }
  }
}

// img: { data RGBA, width, height }; mask: Uint8Array 255 = lo que se elimina.
export function eliminarObjetos(img, mask, { expandir = 2, calidad = 2 } = {}, progreso = () => {}) {
  const { width: W, height: H } = img;
  let m = expandir > 0 ? morph(mask, W, H, expandir, 1) : mask;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return img;

  // Recorte de trabajo: el hueco más un margen de contexto (para no procesar toda la foto).
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  let M = Math.max(48, Math.ceil(Math.max(bw, bh) * 1.2));
  let cx0, cy0, cx1, cy1;
  const recorte = () => { cx0 = Math.max(0, x0 - M); cy0 = Math.max(0, y0 - M); cx1 = Math.min(W - 1, x1 + M); cy1 = Math.min(H - 1, y1 + M); };
  recorte();
  while ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 1_800_000 && M > 32) { M = Math.floor(M * 0.8); recorte(); }
  const w = cx1 - cx0 + 1, h = cy1 - cy0 + 1;

  const rgb0 = new Float32Array(w * h * 3), hole0 = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y + cy0) * W + x + cx0, i = y * w + x;
    rgb0[i * 3] = img.data[s * 4]; rgb0[i * 3 + 1] = img.data[s * 4 + 1]; rgb0[i * 3 + 2] = img.data[s * 4 + 2];
    hole0[i] = m[s] ? 1 : 0;
  }

  // Pirámide: nivel 0 = resolución completa del recorte.
  const niveles = [{ rgb: rgb0, hole: hole0, w, h }];
  while (niveles.length < 7) {
    const u = niveles[niveles.length - 1];
    if (Math.min(u.w, u.h) < 64) break;
    const r = reducir(u.rgb, u.hole, u.w, u.h);
    const cls = clasificar(r.hole, r.w, r.h);
    if (cls.fuentes.length < 200) break;
    niveles.push(r);
  }

  const rand = rng(12345);
  let prev = null; // { rgb, w, h, nnf }
  for (let L = niveles.length - 1; L >= 0; L--) {
    const nv = niveles[L];
    progreso(`Rellenando… (${niveles.length - L}/${niveles.length})`, (niveles.length - 1 - L) / niveles.length);
    const cls = clasificar(nv.hole, nv.w, nv.h);
    if (cls.fuentes.length === 0) {
      // No hay textura de donde copiar: queda el relleno por capas.
      if (!prev) onionFill(nv.rgb, nv.hole, nv.w, nv.h); else subir(prev.rgb, prev.w, prev.h, nv.rgb, nv.hole, nv.w, nv.h);
      prev = { rgb: nv.rgb, w: nv.w, h: nv.h, nnf: null };
      continue;
    }
    if (!prev) onionFill(nv.rgb, nv.hole, nv.w, nv.h);
    else subir(prev.rgb, prev.w, prev.h, nv.rgb, nv.hole, nv.w, nv.h);

    const nnf = new Int32Array(nv.w * nv.h).fill(-1);
    const cost = new Float32Array(nv.w * nv.h);
    for (const p of cls.activos) {
      let s = -1;
      if (prev && prev.nnf) {
        const x = p % nv.w, y = (p / nv.w) | 0;
        const cxg = x >> 1, cyg = y >> 1;
        const q = prev.nnf[cyg * prev.w + cxg];
        if (q >= 0) {
          const sx = (q % prev.w) * 2 + (x & 1), sy = ((q / prev.w) | 0) * 2 + (y & 1);
          if (sx >= PR && sy >= PR && sx < nv.w - PR && sy < nv.h - PR && cls.valido[sy * nv.w + sx]) s = sy * nv.w + sx;
        }
      }
      if (s < 0) s = cls.fuentes[(rand() * cls.fuentes.length) | 0];
      nnf[p] = s;
      cost[p] = costo(nv.rgb, nv.w, p % nv.w, (p / nv.w) | 0, s % nv.w, (s / nv.w) | 0, Infinity);
    }

    const iter = L === 0 ? Math.max(1, calidad) : 3 + calidad;
    for (let e = 0; e < iter; e++) {
      patchMatch(nv.rgb, nv.w, nv.h, cls, nnf, cost, 2, rand);
      votar(nv.rgb, nv.hole, nv.w, nv.h, cls, nnf, cost);
      // Los costos cambian al actualizar el hueco: se recalculan.
      for (const p of cls.activos) cost[p] = costo(nv.rgb, nv.w, p % nv.w, (p / nv.w) | 0, nnf[p] % nv.w, (nnf[p] / nv.w) | 0, Infinity);
    }
    prev = { rgb: nv.rgb, w: nv.w, h: nv.h, nnf };
  }

  // Pega el resultado dentro de la imagen original.
  const out = { data: new Uint8ClampedArray(img.data), width: W, height: H };
  const fin = niveles[0].rgb;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!hole0[i]) continue;
    const s = (y + cy0) * W + x + cx0;
    out.data[s * 4] = fin[i * 3]; out.data[s * 4 + 1] = fin[i * 3 + 1]; out.data[s * 4 + 2] = fin[i * 3 + 2]; out.data[s * 4 + 3] = 255;
  }
  progreso('Listo', 1);
  return out;
}
