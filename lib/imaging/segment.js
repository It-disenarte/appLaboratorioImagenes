import { imageToLab, gaussianBlur, morph } from './core';
import { resizeLanczos } from './upscale';
import { componerResultado } from './bgremove';

// Recortar sujeto SIN IA, al estilo GrabCut:
//  1. Las marcas del usuario (verde = conservar, rojo = quitar) enseñan dos modelos de color (mezclas gaussianas en Lab).
//  2. Un corte de grafo (máximo flujo) elige, para cada píxel, fondo o sujeto equilibrando "qué tanto se parece
//     a cada modelo" con "no cortar donde la imagen es continua".
//  3. Se repite 3 veces reajustando los modelos con lo que ya se decidió.
//  4. El resultado (en resolución de trabajo) se lleva a tamaño real y se ajusta a los bordes de la foto con un
//     filtro guiado, que da un borde suave y preciso.

const INF = 100000000;
const K = 5;

// ---------- Modelo de color: mezcla de gaussianas ----------
function ajustarGMM(muestras, n) {
  // k-means con inicialización dispersa
  const k = Math.max(1, Math.min(K, Math.floor(n / 8)));
  const cen = new Float32Array(k * 3);
  const idx0 = (i) => Math.min(n - 1, Math.floor((i + 0.5) * n / k));
  for (let c = 0; c < k; c++) for (let d = 0; d < 3; d++) cen[c * 3 + d] = muestras[idx0(c) * 3 + d];
  const asign = new Int32Array(n);
  for (let it = 0; it < 8; it++) {
    const suma = new Float64Array(k * 3), cnt = new Int32Array(k);
    for (let i = 0; i < n; i++) {
      let mejor = 0, md = 1e30;
      for (let c = 0; c < k; c++) {
        const a = muestras[i * 3] - cen[c * 3], b = muestras[i * 3 + 1] - cen[c * 3 + 1], e = muestras[i * 3 + 2] - cen[c * 3 + 2];
        const dd = a * a + b * b + e * e;
        if (dd < md) { md = dd; mejor = c; }
      }
      asign[i] = mejor; cnt[mejor]++;
      suma[mejor * 3] += muestras[i * 3]; suma[mejor * 3 + 1] += muestras[i * 3 + 1]; suma[mejor * 3 + 2] += muestras[i * 3 + 2];
    }
    for (let c = 0; c < k; c++) if (cnt[c]) for (let d = 0; d < 3; d++) cen[c * 3 + d] = suma[c * 3 + d] / cnt[c];
  }
  const comps = [];
  for (let c = 0; c < k; c++) {
    let cnt = 0;
    const m = [cen[c * 3], cen[c * 3 + 1], cen[c * 3 + 2]];
    const cov = [0, 0, 0, 0, 0, 0]; // xx xy xz yy yz zz
    for (let i = 0; i < n; i++) {
      if (asign[i] !== c) continue;
      const a = muestras[i * 3] - m[0], b = muestras[i * 3 + 1] - m[1], e = muestras[i * 3 + 2] - m[2];
      cov[0] += a * a; cov[1] += a * b; cov[2] += a * e; cov[3] += b * b; cov[4] += b * e; cov[5] += e * e; cnt++;
    }
    if (cnt < 3) continue;
    for (let j = 0; j < 6; j++) cov[j] /= cnt;
    cov[0] += 6; cov[3] += 6; cov[5] += 6; // regularización
    const [xx, xy, xz, yy, yz, zz] = cov;
    const det = xx * (yy * zz - yz * yz) - xy * (xy * zz - yz * xz) + xz * (xy * yz - yy * xz);
    const inv = [(yy * zz - yz * yz) / det, (xz * yz - xy * zz) / det, (xy * yz - xz * yy) / det, (xx * zz - xz * xz) / det, (xy * xz - xx * yz) / det, (xx * yy - xy * xy) / det];
    comps.push({ m, inv, lc: Math.log(cnt / n) - 0.5 * Math.log(det) - 1.5 * Math.log(2 * Math.PI) });
  }
  return comps;
}

function costoGMM(comps, L, i) {
  const x = L[i * 3], y = L[i * 3 + 1], z = L[i * 3 + 2];
  let mx = -1e30;
  const t = new Array(comps.length);
  for (let c = 0; c < comps.length; c++) {
    const g = comps[c], a = x - g.m[0], b = y - g.m[1], e = z - g.m[2];
    const q = a * a * g.inv[0] + 2 * a * b * g.inv[1] + 2 * a * e * g.inv[2] + b * b * g.inv[3] + 2 * b * e * g.inv[4] + e * e * g.inv[5];
    t[c] = g.lc - 0.5 * q;
    if (t[c] > mx) mx = t[c];
  }
  let s = 0;
  for (let c = 0; c < t.length; c++) s += Math.exp(t[c] - mx);
  return Math.min(30, Math.max(0, -(mx + Math.log(s))));
}

// ---------- Máximo flujo (Dinic) sobre rejilla ----------
function cortar(w, h, capS, capT, wR, wD) {
  const n = w * h, S = n, T = n + 1, N = n + 2;
  const maxArcs = 2 * (2 * n + n) + 8;
  const head = new Int32Array(N).fill(-1), nxt = new Int32Array(maxArcs), to = new Int32Array(maxArcs), cap = new Int32Array(maxArcs);
  let ne = 0;
  const par = (u, v, c1, c2) => {
    to[ne] = v; cap[ne] = c1; nxt[ne] = head[u]; head[u] = ne++;
    to[ne] = u; cap[ne] = c2; nxt[ne] = head[v]; head[v] = ne++;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (capS[p] > 0) par(S, p, capS[p], 0);
    if (capT[p] > 0) par(p, T, capT[p], 0);
    if (x < w - 1 && wR[p] > 0) par(p, p + 1, wR[p], wR[p]);
    if (y < h - 1 && wD[p] > 0) par(p, p + w, wD[p], wD[p]);
  }
  const level = new Int32Array(N), queue = new Int32Array(N), cur = new Int32Array(N), stack = new Int32Array(N + 1);
  const bfs = () => {
    level.fill(-1); level[S] = 0;
    let qh = 0, qt = 0; queue[qt++] = S;
    while (qh < qt) {
      const u = queue[qh++];
      for (let e = head[u]; e !== -1; e = nxt[e]) if (cap[e] > 0 && level[to[e]] < 0) { level[to[e]] = level[u] + 1; queue[qt++] = to[e]; }
    }
    return level[T] >= 0;
  };
  while (bfs()) {
    cur.set(head);
    for (;;) {
      let sp = 0, u = S, agotado = false;
      while (u !== T) {
        let e = cur[u];
        while (e !== -1 && !(cap[e] > 0 && level[to[e]] === level[u] + 1)) e = nxt[e];
        cur[u] = e;
        if (e === -1) {
          if (u === S) { agotado = true; break; }
          level[u] = -1; sp--; u = to[stack[sp] ^ 1];
          continue;
        }
        stack[sp++] = e; u = to[e];
      }
      if (agotado) break;
      let f = INF * 4;
      for (let i = 0; i < sp; i++) if (cap[stack[i]] < f) f = cap[stack[i]];
      for (let i = 0; i < sp; i++) { cap[stack[i]] -= f; cap[stack[i] ^ 1] += f; }
    }
  }
  // Lo alcanzable desde la fuente en el grafo residual es el sujeto.
  level.fill(-1); level[S] = 0;
  let qh = 0, qt = 0; queue[qt++] = S;
  while (qh < qt) {
    const u = queue[qh++];
    for (let e = head[u]; e !== -1; e = nxt[e]) if (cap[e] > 0 && level[to[e]] < 0) { level[to[e]] = 1; queue[qt++] = to[e]; }
  }
  const fg = new Uint8Array(n);
  for (let p = 0; p < n; p++) fg[p] = level[p] >= 0 ? 1 : 0;
  return fg;
}

// ---------- Filtro guiado ----------
function caja(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[o + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[o + x] = s;
      s += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
    }
  }
  const k = 1 / ((2 * r + 1) * (2 * r + 1));
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s * k;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

function filtroGuiado(I, p, w, h, r, eps) {
  const n = w * h;
  const II = new Float32Array(n), Ip = new Float32Array(n);
  for (let i = 0; i < n; i++) { II[i] = I[i] * I[i]; Ip[i] = I[i] * p[i]; }
  const mI = caja(I, w, h, r), mp = caja(p, w, h, r), mII = caja(II, w, h, r), mIp = caja(Ip, w, h, r);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = mII[i] - mI[i] * mI[i], c = mIp[i] - mI[i] * mp[i];
    a[i] = c / (v + eps); b[i] = mp[i] - a[i] * mI[i];
  }
  const ma = caja(a, w, h, r), mb = caja(b, w, h, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i];
  return q;
}

function escalaBilineal(src, sw, sh, dw, dh) {
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * sh / dh - 0.5)), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ay = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sw / dw - 0.5)), x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), ax = fx - x0;
      out[y * dw + x] = (src[y0 * sw + x0] * (1 - ax) + src[y0 * sw + x1] * ax) * (1 - ay) + (src[y1 * sw + x0] * (1 - ax) + src[y1 * sw + x1] * ax) * ay;
    }
  }
  return out;
}

// Se queda solo con las zonas de sujeto conectadas a algo que el usuario marcó para conservar:
// los parches sueltos de otro lado (un trozo de fondo parecido al sujeto) desaparecen.
function soloConectado(et, fijo, w, h) {
  const n = w * h, ok = new Uint8Array(n), cola = new Int32Array(n);
  let qh = 0, qt = 0;
  for (let p = 0; p < n; p++) if (fijo[p] === 1 && et[p]) { ok[p] = 1; cola[qt++] = p; }
  if (qt === 0) return et;
  while (qh < qt) {
    const p = cola[qh++], x = p % w, y = (p / w) | 0;
    if (x > 0 && et[p - 1] && !ok[p - 1]) { ok[p - 1] = 1; cola[qt++] = p - 1; }
    if (x < w - 1 && et[p + 1] && !ok[p + 1]) { ok[p + 1] = 1; cola[qt++] = p + 1; }
    if (y > 0 && et[p - w] && !ok[p - w]) { ok[p - w] = 1; cola[qt++] = p - w; }
    if (y < h - 1 && et[p + w] && !ok[p + w]) { ok[p + w] = 1; cola[qt++] = p + w; }
  }
  return ok;
}

// Quita las manchas sueltas pequeñas: conserva las zonas de sujeto con al menos `frac` del área de la mayor.
function componentesGrandes(et, w, h, frac) {
  const n = w * h, comp = new Int32Array(n).fill(-1), cola = new Int32Array(n), areas = [];
  for (let p0 = 0; p0 < n; p0++) {
    if (!et[p0] || comp[p0] >= 0) continue;
    const id = areas.length; let qh = 0, qt = 0;
    cola[qt++] = p0; comp[p0] = id;
    while (qh < qt) {
      const p = cola[qh++], x = p % w, y = (p / w) | 0;
      if (x > 0 && et[p - 1] && comp[p - 1] < 0) { comp[p - 1] = id; cola[qt++] = p - 1; }
      if (x < w - 1 && et[p + 1] && comp[p + 1] < 0) { comp[p + 1] = id; cola[qt++] = p + 1; }
      if (y > 0 && et[p - w] && comp[p - w] < 0) { comp[p - w] = id; cola[qt++] = p - w; }
      if (y < h - 1 && et[p + w] && comp[p + w] < 0) { comp[p + w] = id; cola[qt++] = p + w; }
    }
    areas.push(qt);
  }
  if (!areas.length) return et;
  const lim = Math.max(...areas) * frac, out = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (comp[p] >= 0 && areas[comp[p]] >= lim) out[p] = 1;
  return out;
}

// Propone semillas de sujeto sin que el usuario marque nada: lo que menos se parece al modelo de fondo.
// `zona` = { cx, cy, ancho, alto } en píxeles de trabajo: el recuadro donde se espera el sujeto (por defecto, toda la imagen).
function sembrarSujeto(lab, fijo, w, h, zona = { cx: w / 2, cy: h / 2, ancho: w, alto: h }, blando = null) {
  const n = w * h;
  const bgIdx = [];
  for (let p = 0; p < n; p++) if (fijo[p] === 2) bgIdx.push(p);
  const m = Math.min(bgIdx.length, 20000), mu = new Float32Array(m * 3);
  for (let i = 0; i < m; i++) { const p = bgIdx[Math.floor((i * bgIdx.length) / m)]; mu[i * 3] = lab[p * 3]; mu[i * 3 + 1] = lab[p * 3 + 1]; mu[i * 3 + 2] = lab[p * 3 + 2]; }
  const gmm = ajustarGMM(mu, m);
  const d = new Float32Array(n);
  const hist = new Float64Array(64);
  for (let p = 0; p < n; p++) { d[p] = costoGMM(gmm, lab, p); hist[Math.min(63, Math.floor(d[p] * 63 / 30))]++; }
  // Umbral de Otsu sobre qué tan "raro" es cada píxel respecto al fondo
  let sumT = 0; for (let t = 0; t < 64; t++) sumT += t * hist[t];
  let wB = 0, sumB = 0, mejorV = -1, th = 20;
  for (let t = 0; t < 64; t++) {
    wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break;
    sumB += t * hist[t];
    const v = wB * wF * (sumB / wB - (sumT - sumB) / wF) ** 2;
    if (v > mejorV) { mejorV = v; th = t; }
  }
  const umbral = Math.max(8, ((th + 1) * 30) / 63);
  // Con recuadro: no se fija nada; se devuelve qué pixeles del interior no parecen fondo para aprender el color del sujeto.
  if (blando) {
    let c = 0;
    for (let p = 0; p < n; p++) if (fijo[p] !== 2 && d[p] > umbral * 0.5) { blando[p] = 1; c++; }
    return c;
  }
  const cand = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (fijo[p] !== 2 && d[p] > umbral) cand[p] = 1;
  // Componentes conectados: se conservan los grandes y cercanos al centro.
  const comp = new Int32Array(n).fill(-1), cola = new Int32Array(n);
  const infos = [];
  for (let p0 = 0; p0 < n; p0++) {
    if (!cand[p0] || comp[p0] >= 0) continue;
    const id = infos.length; let qh = 0, qt = 0, sx = 0, sy = 0;
    cola[qt++] = p0; comp[p0] = id;
    while (qh < qt) {
      const p = cola[qh++], x = p % w, y = (p / w) | 0; sx += x; sy += y;
      if (x > 0 && cand[p - 1] && comp[p - 1] < 0) { comp[p - 1] = id; cola[qt++] = p - 1; }
      if (x < w - 1 && cand[p + 1] && comp[p + 1] < 0) { comp[p + 1] = id; cola[qt++] = p + 1; }
      if (y > 0 && cand[p - w] && comp[p - w] < 0) { comp[p - w] = id; cola[qt++] = p - w; }
      if (y < h - 1 && cand[p + w] && comp[p + w] < 0) { comp[p + w] = id; cola[qt++] = p + w; }
    }
    const cx = (sx / qt - zona.cx) / zona.ancho, cy = (sy / qt - zona.cy) / zona.alto;
    infos.push({ area: qt, puntaje: qt * Math.max(0.15, 1 - 2.2 * Math.hypot(cx, cy)) });
  }
  if (!infos.length) {
    const cx = zona.cx, cy = zona.cy, rx = zona.ancho * 0.15, ry = zona.alto * 0.15; let c = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 && !fijo[y * w + x]) { fijo[y * w + x] = 1; c++; }
    return c;
  }
  const mejor = Math.max(...infos.map((i) => i.puntaje));
  const bueno = infos.map((i) => i.puntaje >= mejor * 0.12 && i.area >= n * 0.002);
  // Semillas: solo el "núcleo" seguro (más raro que el umbral), para que GrabCut decida los bordes.
  let c = 0;
  for (let p = 0; p < n; p++) if (cand[p] && bueno[comp[p]] && d[p] > umbral * 1.4 && !fijo[p]) { fijo[p] = 1; c++; }
  return c;
}

// Convierte una máscara de baja resolución (mw × mh, 0-255, ya estirada al tamaño de la imagen) en el recorte final:
// se lleva a tamaño real y se ajusta a los bordes con el filtro guiado.
export function aplicarMatte(img, matte, mw, mh, o = {}, progreso = () => {}) {
  const { width: W, height: H } = img;
  progreso('Afinando el borde…', 0.7);
  const opaca = { data: new Uint8ClampedArray(img.data), width: W, height: H };
  for (let i = 0; i < W * H; i++) opaca.data[i * 4 + 3] = 255;
  const m0 = new Float32Array(mw * mh);
  for (let i = 0; i < m0.length; i++) m0[i] = matte[i] / 255;
  const g = Math.min(1, Math.sqrt(4e6 / (W * H)));
  const gw = Math.round(W * g), gh = Math.round(H * g);
  const guiaImg = g < 1 ? resizeLanczos(opaca, gw, gh) : opaca;
  const I = new Float32Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) I[i] = (0.299 * guiaImg.data[i * 4] + 0.587 * guiaImg.data[i * 4 + 1] + 0.114 * guiaImg.data[i * 4 + 2]) / 255;
  const P = escalaBilineal(m0, mw, mh, gw, gh);
  const radio = Math.max(2, Math.min(16, Math.round(Math.max(W, H) / 700 * g)));
  const q = filtroGuiado(I, P, gw, gh, radio, 1e-4);
  const qf = g < 1 ? escalaBilineal(q, gw, gh, W, H) : q;
  let a8 = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    let t = (qf[i] - 0.1) / 0.8; t = t < 0 ? 0 : t > 1 ? 1 : t;
    a8[i] = Math.round(255 * t);
  }
  const suav = [0, 0.5, 0.9, 1.4, 2][Math.max(0, Math.min(4, o.suavizado ?? 1))];
  if (suav > 0) {
    const f = gaussianBlur(Float32Array.from(a8), W, H, suav);
    for (let i = 0; i < W * H; i++) a8[i] = Math.max(0, Math.min(255, f[i] + 0.5));
  }
  if (o.contraer > 0) a8 = morph(a8, W, H, o.contraer, -1);
  else if (o.contraer < 0) a8 = morph(a8, W, H, -o.contraer, 1);
  progreso('Listo', 1);
  return componerResultado(img, a8, true);
}

// ---------- Principal ----------
// img: RGBA. marcas: Uint8Array (1 = conservar, 2 = quitar) del tamaño de la imagen.
// opciones: { suavizado 0-4, contraer, bordeFino (bool) }
export function segmentarSujeto(img, marcas, o = {}, progreso = () => {}) {
  const { width: W, height: H } = img;
  const s = Math.min(1, Math.sqrt(260000 / (W * H)));
  const w = Math.max(8, Math.round(W * s)), h = Math.max(8, Math.round(H * s));

  progreso('Preparando…', 0.03);
  const opaca = { data: new Uint8ClampedArray(img.data), width: W, height: H };
  for (let i = 0; i < W * H; i++) opaca.data[i * 4 + 3] = 255;
  const peq = s < 1 ? resizeLanczos(opaca, w, h) : opaca;
  const lab = imageToLab(peq);
  const n = w * h;

  // Marcas a resolución de trabajo (votos, para no perder trazos finos).
  const vf = new Uint16Array(n), vb = new Uint16Array(n);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const m = marcas[y * W + x];
    if (!m) continue;
    const p = Math.min(h - 1, Math.floor(y * s)) * w + Math.min(w - 1, Math.floor(x * s));
    if (m === 1) vf[p]++; else vb[p]++;
  }
  const fijo = new Uint8Array(n); // 0 libre, 1 sujeto, 2 fondo
  let nf = 0, nb = 0;
  for (let p = 0; p < n; p++) { if (vf[p] || vb[p]) { fijo[p] = vf[p] >= vb[p] ? 1 : 2; if (fijo[p] === 1) nf++; else nb++; } }
  // Sin marcas de un lado, se deducen: el fondo se aprende del marco exterior (o de lo que el usuario marcó
  // como "quitar") y el sujeto es lo que más se aparta de ese fondo, cerca del centro.
  // Silueta trazada con el lazo: el interior (sin la franja del borde) es sujeto seguro y el exterior (más allá
  // de la franja) es fondo seguro. Solo la franja alrededor de la línea la decide el corte.
  if (o.silueta) {
    const m = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(H - 1, Math.floor((y + 0.5) / s));
      for (let x = 0; x < w; x++) m[y * w + x] = o.silueta[sy * W + Math.min(W - 1, Math.floor((x + 0.5) / s))] ? 1 : 0;
    }
    const banda = Math.max(2, Math.round(Math.min(w, h) * (o.banda ?? 0.012)));
    const nucleo = morph(m, w, h, banda, -1), fuera = morph(m, w, h, banda, 1);
    for (let p = 0; p < n; p++) {
      if (fijo[p]) continue;
      if (nucleo[p]) { fijo[p] = 1; nf++; } else if (!fuera[p]) { fijo[p] = 2; nb++; }
    }
  }
  // Recuadro dibujado por el usuario: todo lo de fuera es fondo seguro.
  let zona, blando = null; // blando: sujeto probable (no fijo) cuando solo hay recuadro
  const cj = o.caja;
  if (cj && cj.w > 4 && cj.h > 4) {
    const x0 = Math.max(0, Math.floor(cj.x * s)), y0 = Math.max(0, Math.floor(cj.y * s));
    const x1 = Math.min(w, Math.ceil((cj.x + cj.w) * s)), y1 = Math.min(h, Math.ceil((cj.y + cj.h) * s));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if ((x < x0 || x >= x1 || y < y0 || y >= y1) && fijo[y * w + x] === 0) { fijo[y * w + x] = 2; nb++; }
    }
    zona = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, ancho: Math.max(1, x1 - x0), alto: Math.max(1, y1 - y0) };
  }
  if (nb === 0) {
    const g = Math.max(2, Math.round(Math.min(w, h) * 0.03));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < g || y < g || x >= w - g || y >= h - g) { fijo[y * w + x] = 2; nb++; }
  }
  if (zona) {
    progreso('Buscando el sujeto…', 0.05);
    blando = new Uint8Array(n);
    if (!sembrarSujeto(lab, fijo, w, h, zona, blando)) blando = null;
  }
  if (nf === 0 && !blando) {
    progreso('Buscando el sujeto…', 0.05);
    nf = sembrarSujeto(lab, fijo, w, h, zona);
  }

  // Peso entre vecinos: grande donde la imagen es continua, pequeño sobre los bordes.
  progreso('Analizando bordes…', 0.08);
  const dR = new Float32Array(n), dD = new Float32Array(n);
  let suma = 0, cnt = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (x < w - 1) { const a = lab[p * 3] - lab[p * 3 + 3], b = lab[p * 3 + 1] - lab[p * 3 + 4], c = lab[p * 3 + 2] - lab[p * 3 + 5]; dR[p] = a * a + b * b + c * c; suma += dR[p]; cnt++; }
    if (y < h - 1) { const q = p + w, a = lab[p * 3] - lab[q * 3], b = lab[p * 3 + 1] - lab[q * 3 + 1], c = lab[p * 3 + 2] - lab[q * 3 + 2]; dD[p] = a * a + b * b + c * c; suma += dD[p]; cnt++; }
  }
  const beta = 1 / (2 * (suma / cnt) + 1e-6);
  const GAMMA = 24, ESC = 16;
  const wR = new Int32Array(n), wD = new Int32Array(n);
  for (let p = 0; p < n; p++) { wR[p] = Math.round(ESC * GAMMA * Math.exp(-beta * dR[p])); wD[p] = Math.round(ESC * GAMMA * Math.exp(-beta * dD[p])); }

  // GrabCut: 3 rondas de (ajustar modelos → cortar).
  let etiqueta = new Uint8Array(n); // 1 sujeto
  for (let p = 0; p < n; p++) etiqueta[p] = fijo[p] === 1 ? 1 : 0;
  const RONDAS = 3;
  for (let ronda = 0; ronda < RONDAS; ronda++) {
    progreso(`Aprendiendo colores y cortando… (${ronda + 1}/${RONDAS})`, 0.12 + (0.6 * ronda) / RONDAS);
    const mf = [], mb = [];
    for (let p = 0; p < n; p++) {
      const esF = ronda === 0 ? fijo[p] === 1 || (blando && blando[p] === 1) : etiqueta[p] === 1;
      const esB = ronda === 0 ? fijo[p] === 2 : etiqueta[p] === 0;
      if (esF) mf.push(p); else if (esB) mb.push(p);
    }
    const tomar = (lista) => {
      const m = Math.min(lista.length, 25000), out = new Float32Array(m * 3);
      for (let i = 0; i < m; i++) { const p = lista[Math.floor((i * lista.length) / m)]; out[i * 3] = lab[p * 3]; out[i * 3 + 1] = lab[p * 3 + 1]; out[i * 3 + 2] = lab[p * 3 + 2]; }
      return [out, m];
    };
    const [sf, nF] = tomar(mf), [sb, nB] = tomar(mb);
    const gf = ajustarGMM(sf, nF), gb = ajustarGMM(sb, nB);
    const capS = new Int32Array(n), capT = new Int32Array(n);
    for (let p = 0; p < n; p++) {
      if (fijo[p] === 1) { capS[p] = INF; continue; }
      if (fijo[p] === 2) { capT[p] = INF; continue; }
      const df = costoGMM(gf, lab, p), db = costoGMM(gb, lab, p);
      const m = Math.min(df, db);
      capT[p] = Math.round(ESC * (df - m)); // cortar p→T cuesta Dsujeto (p queda como sujeto)
      capS[p] = Math.round(ESC * (db - m)); // cortar S→p cuesta Dfondo
    }
    etiqueta = cortar(w, h, capS, capT, wR, wD);
    etiqueta = blando ? componentesGrandes(etiqueta, w, h, 0.12) : soloConectado(etiqueta, fijo, w, h);
  }

  // Máscara suave a resolución de trabajo → tamaño real → ajuste a los bordes.
  progreso('Afinando el borde…', 0.78);
  const m0 = new Float32Array(n);
  for (let p = 0; p < n; p++) m0[p] = etiqueta[p];
  const m1 = gaussianBlur(m0, w, h, 0.9);

  // El filtro guiado trabaja hasta ~4 MP; si la imagen es más grande, se sube bilineal al final.
  const g = Math.min(1, Math.sqrt(4e6 / (W * H)));
  const gw = Math.round(W * g), gh = Math.round(H * g);
  const guiaImg = g < 1 ? resizeLanczos(opaca, gw, gh) : opaca;
  const I = new Float32Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) I[i] = (0.299 * guiaImg.data[i * 4] + 0.587 * guiaImg.data[i * 4 + 1] + 0.114 * guiaImg.data[i * 4 + 2]) / 255;
  const P = escalaBilineal(m1, w, h, gw, gh);
  const radio = Math.max(2, Math.min(24, Math.round((1 / s) * 1.6 * g)));
  const q = filtroGuiado(I, P, gw, gh, radio, 4e-4);
  const qf = g < 1 ? escalaBilineal(q, gw, gh, W, H) : q;

  let a8 = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    let t = (qf[i] - 0.12) / 0.76; t = t < 0 ? 0 : t > 1 ? 1 : t;
    a8[i] = Math.round(255 * t * t * (3 - 2 * t));
  }
  // Las marcas del usuario mandan.
  for (let i = 0; i < W * H; i++) { if (marcas[i] === 1) a8[i] = 255; else if (marcas[i] === 2) a8[i] = 0; }
  const suav = [0, 0.6, 1.0, 1.5, 2.2][Math.max(0, Math.min(4, o.suavizado ?? 1))];
  if (suav > 0) {
    const f = gaussianBlur(Float32Array.from(a8), W, H, suav);
    for (let i = 0; i < W * H; i++) a8[i] = Math.max(0, Math.min(255, f[i] + 0.5));
  }
  if (o.contraer > 0) a8 = morph(a8, W, H, o.contraer, -1);
  else if (o.contraer < 0) a8 = morph(a8, W, H, -o.contraer, 1);

  progreso('Listo', 1);
  return componerResultado(img, a8, true);
}
