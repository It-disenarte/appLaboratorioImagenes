// Genera favicon, íconos de la PWA y apple-touch-icon a partir de la "hoja" dorada + pictograma de imagen.
// Uso: NODE_PATH=<carpeta con sharp> node scripts/iconos.js
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, '..', 'public');
const ORO = '#E0A526';
const HOJA = 'M205 0 H456 A56 56 0 0 1 512 56 V307 A205 205 0 0 1 307 512 H56 A56 56 0 0 1 0 456 V205 A205 205 0 0 1 205 0 Z';
const PICTO = (escala, color = '#fff') => {
  const s = 11.5 * escala, t = 256 - 12 * s;
  return `<g transform="translate(${t} ${t}) scale(${s})" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></g>`;
};
const svgHoja = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="${HOJA}" fill="${ORO}"/>${PICTO(1)}</svg>`;
const svgCuadrado = (esc) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${ORO}"/>${PICTO(esc)}</svg>`;

(async () => {
  fs.writeFileSync(path.join(out, 'favicon.svg'), svgHoja);
  const png = (svg, size) => sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png().toBuffer();
  fs.writeFileSync(path.join(out, 'icono-192.png'), await png(svgHoja, 192));
  fs.writeFileSync(path.join(out, 'icono-512.png'), await png(svgHoja, 512));
  fs.writeFileSync(path.join(out, 'icono-512-maskable.png'), await png(svgCuadrado(0.8), 512));
  fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), await png(svgCuadrado(0.9), 180));
  // favicon.ico con PNG de 16, 32 y 48
  const tamanos = [16, 32, 48];
  const imgs = await Promise.all(tamanos.map((s) => png(svgHoja, s)));
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
  let offset = 6 + 16 * imgs.length;
  const dirs = imgs.map((b, i) => {
    const d = Buffer.alloc(16);
    d.writeUInt8(tamanos[i], 0); d.writeUInt8(tamanos[i], 1); d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6);
    d.writeUInt32LE(b.length, 8); d.writeUInt32LE(offset, 12); offset += b.length; return d;
  });
  fs.writeFileSync(path.join(out, 'favicon.ico'), Buffer.concat([head, ...dirs, ...imgs]));
  console.log('Íconos listos');
})();
