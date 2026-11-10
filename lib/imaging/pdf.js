// Convierte el SVG que genera el vectorizador (rutas con M, L, Q, Z y relleno rgb) a un PDF vectorial de una página.
// Sirve para llevar el resultado a programas que abren mejor PDF que SVG.

const f = (n) => (Math.round(n * 1000) / 1000).toString();

export function svgAPdf(svg, ancho, alto) {
  const partes = [];
  const reRuta = /<path fill="rgb\((\d+),(\d+),(\d+)\)"[^>]*?\sd="([^"]*)"/g;
  let m;
  while ((m = reRuta.exec(svg))) {
    const [, r, g, b, d] = m;
    let s = `${f(r / 255)} ${f(g / 255)} ${f(b / 255)} rg\n`;
    const tokens = d.match(/[MLQZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
    let i = 0, cx = 0, cy = 0;
    const num = () => parseFloat(tokens[i++]);
    const Y = (y) => alto - y;
    while (i < tokens.length) {
      const c = tokens[i++];
      if (c === 'M') { cx = num(); cy = num(); s += `${f(cx)} ${f(Y(cy))} m\n`; }
      else if (c === 'L') { cx = num(); cy = num(); s += `${f(cx)} ${f(Y(cy))} l\n`; }
      else if (c === 'Q') {
        const qx = num(), qy = num(), x = num(), y = num();
        const c1x = cx + (2 / 3) * (qx - cx), c1y = cy + (2 / 3) * (qy - cy);
        const c2x = x + (2 / 3) * (qx - x), c2y = y + (2 / 3) * (qy - y);
        s += `${f(c1x)} ${f(Y(c1y))} ${f(c2x)} ${f(Y(c2y))} ${f(x)} ${f(Y(y))} c\n`;
        cx = x; cy = y;
      } else if (c === 'Z' || c === 'z') s += 'h\n';
    }
    s += 'f\n';
    partes.push(s);
  }
  const contenido = partes.join('');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(ancho)} ${f(alto)}] /Contents 4 0 R /Resources << >> >>`,
    `<< /Length ${contenido.length} >>\nstream\n${contenido}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, k) => { offs.push(pdf.length); pdf += `${k + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offs.forEach((o) => { pdf += `${String(o).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const bytes = new Uint8Array(pdf.length);
  for (let k = 0; k < pdf.length; k++) bytes[k] = pdf.charCodeAt(k) & 255;
  return bytes;
}
