// Web Worker: las operaciones pesadas corren aquí para que la pantalla no se congele.
import { mejorarCalidad, resizeLanczos } from './upscale';
import { quitarFondo, componerResultado } from './bgremove';
import { eliminarObjetos } from './inpaint';
import { vectorizar } from './vectorize';
import { segmentarSujeto, aplicarMatte } from './segment';
import { analizarImagen } from './analyze';

self.onmessage = (e) => {
  const { id, op, img, mask, opts } = e.data;
  const progreso = (msg, p) => self.postMessage({ id, tipo: 'progreso', msg, p });
  try {
    let res, transfer = [];
    if (op === 'calidad') {
      res = mejorarCalidad(img, opts, progreso);
      transfer = [res.data.buffer];
    } else if (op === 'fondo') {
      progreso('Analizando colores…', 0.3);
      res = quitarFondo(img, opts);
      transfer = [res.data.buffer, res.alfa.buffer];
    } else if (op === 'componer') {
      res = componerResultado(img, mask, opts?.defringe !== false);
      transfer = [res.data.buffer];
      res.alfa = undefined;
    } else if (op === 'objetos') {
      res = eliminarObjetos(img, mask, opts, progreso);
      transfer = [res.data.buffer];
    } else if (op === 'sujeto') {
      res = segmentarSujeto(img, mask, opts, progreso);
      transfer = [res.data.buffer, res.alfa.buffer];
    } else if (op === 'matte') {
      res = aplicarMatte(img, mask, opts.mw, opts.mh, opts, progreso);
      transfer = [res.data.buffer, res.alfa.buffer];
    } else if (op === 'redimensionar') {
      res = resizeLanczos(img, opts.w, opts.h);
      transfer = [res.data.buffer];
    } else if (op === 'analizar') {
      res = analizarImagen(img);
    } else if (op === 'vector') {
      res = vectorizar(img, opts, progreso);
    } else throw new Error('Operación desconocida');
    self.postMessage({ id, tipo: 'ok', res }, transfer);
  } catch (err) {
    self.postMessage({ id, tipo: 'error', msg: String(err && err.message || err) });
  }
};
