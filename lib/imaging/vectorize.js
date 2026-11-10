import ImageTracer from 'imagetracerjs';
import { resizeLanczos } from './upscale';
import { gaussianBlur } from './core';
import { extraerPaleta } from './paleta';

// Vectorizar SIN IA: se reducen los colores de la imagen (k-means) y se trazan los contornos de cada color
// como curvas (ImageTracer). El resultado es un SVG que abre Illustrator, CorelDRAW, Inkscape o Affinity.

const hex = (c) => '#' + [c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, '0')).join('');

function colorDeFondo(img) {
  // Color más frecuente en el contorno de la imagen.
  const { width: w, height: h, data } = img;
  const cuenta = new Map();
  const toma = (x, y) => {
    const i = (y * w + x) * 4;
    const k = (data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4);
    const e = cuenta.get(k) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2];
    cuenta.set(k, e);
  };
  for (let x = 0; x < w; x += 2) { toma(x, 0); toma(x, h - 1); }
  for (let y = 0; y < h; y += 2) { toma(0, y); toma(w - 1, y); }
  let mejor = null;
  for (const e of cuenta.values()) if (!mejor || e.n > mejor.n) mejor = e;
  return [Math.round(mejor.r / mejor.n), Math.round(mejor.g / mejor.n), Math.round(mejor.b / mejor.n)];
}

// opciones: { modo: 'logo'|'bn'|'foto', colores, detalle 0-100, suavizar 0-100, umbral 0-255, sinFondo, ampliar }
export function vectorizar(img, o = {}, progreso = () => {}) {
  const modo = o.modo || 'logo';
  const ow = img.width, oh = img.height;

  // 1) Aplana la transparencia sobre blanco (o sobre el fondo, si lo vamos a quitar).
  let src = { data: new Uint8ClampedArray(img.data), width: ow, height: oh };
  let teniaTransparencia = false;
  for (let i = 0; i < ow * oh; i++) {
    const a = src.data[i * 4 + 3];
    if (a < 255) {
      teniaTransparencia = true;
      const k = a / 255;
      src.data[i * 4] = src.data[i * 4] * k + 255 * (1 - k);
      src.data[i * 4 + 1] = src.data[i * 4 + 1] * k + 255 * (1 - k);
      src.data[i * 4 + 2] = src.data[i * 4 + 2] * k + 255 * (1 - k);
      src.data[i * 4 + 3] = 255;
    }
  }

  // 2) Imágenes pequeñas: se amplían antes de trazar (curvas más suaves); el SVG se escala de vuelta.
  progreso('Preparando imagen…', 0.1);
  let f = 1;
  const lado = Math.max(ow, oh);
  if (o.ampliar !== false && lado < 1400) f = Math.min(4, Math.max(2, Math.round(1600 / lado)));
  if (f > 1) src = resizeLanczos(src, ow * f, oh * f);

  // 3) Suavizado previo: quita dientes de sierra y ruido antes de contar colores.
  const sg = ((o.suavizar ?? 30) / 100) * (modo === 'foto' ? 2.2 : 1.6) * (f > 1 ? f * 0.6 : 1);
  if (sg > 0.2) {
    const n = src.width * src.height;
    for (let c = 0; c < 3; c++) {
      const ch = new Float32Array(n);
      for (let i = 0; i < n; i++) ch[i] = src.data[i * 4 + c];
      const b = gaussianBlur(ch, src.width, src.height, sg);
      for (let i = 0; i < n; i++) src.data[i * 4 + c] = b[i];
    }
  }

  const detalle = o.detalle ?? 60;
  const opts = {
    ltres: 1, qtres: 1, rightangleenhance: modo !== 'foto', colorsampling: 1, colorquantcycles: 3, mincolorratio: 0,
    layering: 0, strokewidth: 0, linefilter: false, roundcoords: 2, blurradius: 0, scale: 1 / f, viewbox: true, desc: false,
    // pathomit: ignora manchitas de menos de N píxeles (más detalle = menos descarte)
    pathomit: Math.max(2, Math.round((24 - detalle * 0.2) * f * f * 0.5)),
  };

  let nColores;
  if (modo === 'bn') {
    const { data, width: w, height: h } = src;
    const n = w * h;
    const umbral = o.umbral ?? 128;
    for (let i = 0; i < n; i++) {
      const l = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
      const v = l < umbral ? 0 : 255;
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    }
    opts.pal = [{ r: 0, g: 0, b: 0, a: 255 }, { r: 255, g: 255, b: 255, a: 255 }];
    opts.numberofcolors = 2; opts.colorsampling = 0; opts.colorquantcycles = 1;
    nColores = 2;
  } else {
    nColores = Math.max(2, Math.min(modo === 'foto' ? 64 : 32, o.colores ?? (modo === 'foto' ? 24 : 8)));
    // Paleta determinista (el muestreo aleatorio de ImageTracer daba colores distintos en cada ejecución).
    const pal = extraerPaleta(src, nColores, { exacta: modo !== 'foto' }).map((h) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16), a: 255 }));
    opts.pal = pal; opts.numberofcolors = pal.length; opts.colorsampling = 0; opts.colorquantcycles = 1;
  }

  progreso('Trazando contornos…', 0.35);
  let svg = ImageTracer.imagedataToSVG({ data: src.data, width: src.width, height: src.height }, opts);

  // 4) Dimensiones reales y limpieza del fondo.
  progreso('Limpiando resultado…', 0.9);
  svg = svg.replace(/<svg [^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" width="${ow}" height="${oh}" viewBox="0 0 ${ow} ${oh}">`);
  // Las rutas ya vienen en coordenadas del original porque se usó scale = 1 / f.
  let quitadas = 0;
  // En fotos solo se quita el fondo si la imagen ya traía transparencia: quitar "lo parecido al color del borde"
  // en una foto borraría zonas reales de la imagen.
  if (o.sinFondo !== false && (modo === 'bn' || teniaTransparencia || (o.sinFondo === true && modo !== 'foto'))) {
    const bg = modo === 'bn' ? [255, 255, 255] : teniaTransparencia ? [255, 255, 255] : colorDeFondo(src);
    svg = svg.replace(/<path fill="rgb\((\d+),(\d+),(\d+)\)"[^>]*\/>/g, (m, r, g, b) => {
      const d = Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]);
      if (d < 54) { quitadas++; return ''; }
      return m;
    });
  }
  const colores = new Set();
  const rutas = (svg.match(/<path /g) || []).length;
  svg.replace(/<path fill="rgb\((\d+),(\d+),(\d+)\)"/g, (m, r, g, b) => { colores.add(hex([+r, +g, +b])); return m; });
  progreso('Listo', 1);
  return { svg, rutas, colores: [...colores], ancho: ow, alto: oh, quitadas };
}
