// Análisis de la imagen al cargarla: mide resolución, nitidez, ruido, bloques de JPG, cantidad de colores y
// uniformidad del fondo, y con eso propone ajustes para cada herramienta. Todo son heurísticas medidas sobre
// los píxeles (sin IA), así que son una sugerencia razonable, no una verdad absoluta.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function analizarImagen(img) {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const lado = Math.max(w, h);

  // Luminancia y transparencia
  const Y = new Float32Array(n);
  let transp = 0;
  for (let i = 0; i < n; i++) {
    Y[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    if (data[i * 4 + 3] < 250) transp++;
  }

  // Nitidez (|Laplaciano| de los bordes más fuertes), ruido (Immerkaer en zonas planas) y bloques de JPG
  const lap = [];
  let sumaRuido = 0, cntRuido = 0;
  let bordeB = 0, bordeBn = 0, internoB = 0, internoBn = 0;
  const paso = n > 3e6 ? 2 : 1;
  const gradVals = [];
  for (let y = 2; y < h - 2; y += paso) {
    for (let x = 2; x < w - 2; x += paso) {
      const i = y * w + x;
      const gx = Y[i + 1] - Y[i - 1], gy = Y[i + w] - Y[i - w];
      const g = Math.abs(gx) + Math.abs(gy);
      const l = Math.abs(4 * Y[i] - Y[i - 1] - Y[i + 1] - Y[i - w] - Y[i + w]);
      lap.push(l); gradVals.push(g);
      const im = Math.abs(Y[i - w - 1] - 2 * Y[i - w] + Y[i - w + 1] - 2 * Y[i - 1] + 4 * Y[i] - 2 * Y[i + 1] + Y[i + w - 1] - 2 * Y[i + w] + Y[i + w + 1]);
      if (g < 12) { sumaRuido += im; cntRuido++; }
      // Bloques: diferencia horizontal entre columnas vecinas, en la frontera de 8 px o dentro del bloque.
      const d = Math.abs(Y[i] - Y[i - 1]);
      if (d < 40) { if (x % 8 === 0) { bordeB += d; bordeBn++; } else { internoB += d; internoBn++; } }
    }
  }
  lap.sort((a, b) => a - b);
  const top = lap.slice(Math.floor(lap.length * 0.95));
  const nitidez = top.length ? top.reduce((s, v) => s + v, 0) / top.length : 0;
  const ruido = cntRuido > 200 ? (Math.sqrt(Math.PI / 2) / 6) * (sumaRuido / cntRuido) : 0;
  const bloques = bordeBn > 50 && internoBn > 50 && internoB > 0 ? (bordeB / bordeBn) / (internoB / internoBn) : 1;

  // Colores: histograma de 12 bits sobre una muestra
  const hist = new Map();
  const salto = Math.max(1, Math.floor(Math.sqrt(n / 250000)));
  let total = 0;
  for (let y = 0; y < h; y += salto) for (let x = 0; x < w; x += salto) {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 128) continue;
    const k = (data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4);
    hist.set(k, (hist.get(k) || 0) + 1); total++;
  }
  const ord = [...hist.entries()].sort((a, b) => b[1] - a[1]);
  const cobertura8 = total ? ord.slice(0, 8).reduce((s, e) => s + e[1], 0) / total : 0;
  // Colores "dominantes": los que ocupan ≥ 1.2 % y no son casi iguales a otro mayor
  const dom = [];
  for (const [k, c] of ord) {
    if (c / total < 0.012) break;
    const r = k >> 8, g = (k >> 4) & 15, b = k & 15;
    if (!dom.some((d) => Math.abs(d.r - r) + Math.abs(d.g - g) + Math.abs(d.b - b) <= 3)) dom.push({ r, g, b, c });
  }
  const gris = dom.length > 0 && dom.every((d) => Math.max(d.r, d.g, d.b) - Math.min(d.r, d.g, d.b) <= 2);

  // Uniformidad del borde (¿fondo liso?)
  const cuentaB = new Map();
  let tb = 0;
  const probar = (x, y) => { const i = (y * w + x) * 4; const k = (data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4); cuentaB.set(k, (cuentaB.get(k) || 0) + 1); tb++; };
  for (let x = 0; x < w; x += 2) { probar(x, 0); probar(x, h - 1); }
  for (let y = 0; y < h; y += 2) { probar(0, y); probar(w - 1, y); }
  const mejorB = Math.max(...cuentaB.values());
  const bordeUniforme = mejorB / tb;

  // Umbral de Otsu para blanco y negro
  const hy = new Float64Array(256);
  for (let i = 0; i < n; i += salto) hy[Math.round(Y[i])]++;
  let sumT = 0, tot = 0;
  for (let t = 0; t < 256; t++) { sumT += t * hy[t]; tot += hy[t]; }
  let sumB = 0, wB = 0, maxV = -1, otsu = 128;
  for (let t = 0; t < 256; t++) {
    wB += hy[t]; if (!wB) continue;
    const wF = tot - wB; if (!wF) break;
    sumB += t * hy[t];
    const v = wB * wF * (sumB / wB - (sumT - sumB) / wF) ** 2;
    if (v > maxV) { maxV = v; otsu = t; }
  }

  const esGrafico = cobertura8 > 0.8 && ruido < 3;
  const m = { ancho: w, alto: h, mp: n / 1e6, transparencia: transp / n, nitidez, ruido, bloques, cobertura8, colores: dom.length, gris, bordeUniforme, otsu, esGrafico };
  return { metricas: m, sugerencia: sugerir(m) };
}

function sugerir(m) {
  const lado = Math.max(m.ancho, m.alto);
  const resumen = [];
  const tipo = m.esGrafico ? 'un gráfico o logo (pocos colores definidos)' : 'una fotografía o imagen con muchos tonos';
  resumen.push(`Parece ${tipo}, de ${m.ancho} × ${m.alto} px (${m.mp.toFixed(1)} MP).`);

  // ---- Mejorar calidad ----
  const borrosa = m.nitidez < (m.esGrafico ? 20 : 14);
  const nitida = m.nitidez > 55;
  const jpg = m.bloques > 1.15;
  const ruidosa = m.ruido > 3.5;
  let factor = lado < 600 ? 4 : lado < 1100 ? 3 : lado < 2000 ? 2 : 1;
  const porQue = [];
  if (factor > 1) porQue.push(`mide ${lado} px de lado largo, así que conviene agrandarla ${factor}× (quedaría de ${Math.round(m.ancho * factor)} × ${Math.round(m.alto * factor)} px)`);
  else porQue.push(`ya tiene buena resolución (${lado} px de lado largo), no hace falta agrandarla`);
  let limpiar = 10, nitidezAj = 45, preset = m.esGrafico ? 'grafico' : 'foto';
  if (jpg) { limpiar = ruidosa ? 80 : 65; preset = 'jpg'; porQue.push('se notan los cuadritos de compresión JPG: se sube la limpieza'); }
  else if (ruidosa) { limpiar = 55; porQue.push('tiene grano o ruido visible: se sube la limpieza'); }
  else if (m.ruido > 1.8) { limpiar = 30; }
  else if (m.esGrafico) { limpiar = 8; }
  else limpiar = 20;
  if (borrosa) { nitidezAj = 70; porQue.push('está algo borrosa: se sube la nitidez'); }
  else if (nitida) { nitidezAj = 30; porQue.push('ya es bastante nítida: se baja la nitidez para evitar halos'); }
  else if (m.esGrafico) nitidezAj = 35;
  if (lado >= 4500) factor = 1;
  const calidad = { factor, nitidez: nitidezAj, limpiar: clamp(limpiar, 0, 100), preset, porQue };

  // ---- Quitar fondo ----
  const lisa = m.bordeUniforme > 0.85;
  const fondo = lisa
    ? { modo: 'bordes', preset: m.esGrafico ? 'logo' : 'foto', tolerancia: m.esGrafico ? 22 : 26, porQue: `El fondo es casi de un solo color (${Math.round(m.bordeUniforme * 100)} % del contorno), así que el método Automático debería funcionar bien.` }
    : { modo: 'sujeto', preset: 'foto', tolerancia: 28, porQue: 'El fondo tiene muchos colores o detalles; el método por color no lo separa bien. Prueba primero «Recortar con precisión» (un clic, sin marcas). Si queda algo mal, usa «Marcar sujeto» con un recuadro o la silueta y corrige con marcas verdes y rojas.' };

  // ---- Vectorizar ----
  let vector;
  if ((m.gris && m.colores <= 3) || m.colores <= 2) {
    vector = { modo: 'bn', colores: 2, umbral: clamp(m.otsu, 60, 200), detalle: 65, suavizar: 30, porQue: 'Tiene solo uno o dos tonos: conviene vectorizar a una tinta (blanco y negro).' };
  } else if (m.esGrafico) {
    const c = clamp(m.colores + 1, 3, 16);
    vector = { modo: 'logo', colores: c, umbral: 128, detalle: 65, suavizar: lado < 800 ? 45 : 30, porQue: `Detecté unos ${m.colores} colores dominantes: se vectoriza como logo con ${c} colores (cuenta el del fondo).` };
  } else {
    vector = { modo: 'foto', colores: 24, umbral: 128, detalle: 55, suavizar: 40, porQue: 'Tiene muchos tonos: se vectoriza en modo Foto (efecto de ilustración por capas). Si es un logo, prueba el modo Logo con pocos colores.' };
  }

  return { resumen, calidad, fondo, vector };
}
