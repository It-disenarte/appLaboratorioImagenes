import { useEffect, useRef, useState } from 'react';
import Visor from '../Visor';
import { Deslizador, Segmentos, Casilla, Panel, Seccion, Aviso, Sugerencia, nombreBase, Icon } from '../ui';
import { aBlob, descargar } from '../../lib/imaging/client';
import { cajaDeContenido } from '../../lib/imaging/bgremove';
import { prepararLazo, trazarLazo, ajustarPunto } from '../../lib/imaging/lazo';

const LAZO_VACIO = { anchors: [], tramos: [], cerrado: false };

const SELECCION = ['caja', 'libre', 'lazo']; // formas de encerrar al sujeto

// Rellena la silueta (lista de tramos) y devuelve una máscara 1/0 del tamaño de la imagen.
// `grosor` > 0 la ensancha esa cantidad de píxeles en total (mitad hacia cada lado del contorno).
function mascaraSilueta(tramos, w, h, grosor = 0) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.strokeStyle = '#000';
  ctx.beginPath();
  let primero = true;
  for (const t of tramos) for (const [x, y] of t) { if (primero) { ctx.moveTo(x, y); primero = false; } else ctx.lineTo(x, y); }
  ctx.closePath(); ctx.fill();
  if (grosor > 0) { ctx.lineWidth = grosor; ctx.lineJoin = 'round'; ctx.stroke(); }
  const d = ctx.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 127 ? 1 : 0;
  return m;
}

const PRESETS = [
  ['logo', 'Logo', { tolerancia: 22, suavizado: 1, interior: false, degradado: false }],
  ['foto', 'Foto', { tolerancia: 28, suavizado: 2, interior: false, degradado: false }],
  ['degradado', 'Degradado', { tolerancia: 30, suavizado: 2, interior: false, degradado: true }],
];
const COLOR_MARCA = { conservar: 'rgba(46,125,79,0.6)', quitar: 'rgba(179,38,30,0.55)' };
const ES_MARCA = ['conservar', 'quitar', 'borrarMarca'];

function recortar(img, caja) {
  const out = new Uint8ClampedArray(caja.w * caja.h * 4);
  for (let y = 0; y < caja.h; y++) {
    const s = ((y + caja.y) * img.width + caja.x) * 4;
    out.set(img.data.subarray(s, s + caja.w * 4), y * caja.w * 4);
  }
  return { data: out, width: caja.w, height: caja.h };
}

export default function Fondo({ doc, analisis, ejecutar, aplicar }) {
  const img = doc.img;
  const visor = useRef(null);
  const marcas = useRef(null); // 1 = conservar, 2 = quitar
  const [modo, setModo] = useState('sujeto');
  const [preset, setPreset] = useState('foto');
  const [tolerancia, setTolerancia] = useState(28);
  const [suavizado, setSuavizado] = useState(1);
  const [contraer, setContraer] = useState(0);
  const [interior, setInterior] = useState(false);
  const [degradado, setDegradado] = useState(false);
  const [conectado, setConectado] = useState(true);
  const [recorta, setRecorta] = useState(false);
  const [res, setRes] = useState(null); // { img, alfa }
  const [, setVersion] = useState(0);
  const [pincel, setPincel] = useState('conservar');
  const [radio, setRadio] = useState(16);
  const [error, setError] = useState('');
  const [nMarcas, setNMarcas] = useState({ conservar: 0, quitar: 0 });
  const [caja, setCaja] = useState(null); // recuadro alrededor del sujeto, en píxeles de la imagen
  const inicioCaja = useRef(null);
  const trazoLibre = useRef([]); // puntos del lazo libre mientras se dibuja
  const [lazo, setLazo] = useState(LAZO_VACIO); // silueta del lazo magnético
  const [vivo, setVivo] = useState([]); // tramo de vista previa hasta el cursor
  const lazoRef = useRef(lazo);
  lazoRef.current = lazo;
  const prepLazo = useRef({ img: null, prep: null });
  const hoverPend = useRef(null);
  const deshacer = useRef([]);
  const idRef = useRef(null);
  const pintandoInicio = useRef(false);

  useEffect(() => {
    setRes(null); setError(''); deshacer.current = []; setCaja(null); setLazo(LAZO_VACIO); setVivo([]);
    marcas.current = new Uint8Array(img.width * img.height);
    setNMarcas({ conservar: 0, quitar: 0 });
    if (visor.current) visor.current.limpiarMarcas();
  }, [img]);

  function elegirPreset(k) {
    const p = PRESETS.find((x) => x[0] === k)[2];
    setPreset(k); setTolerancia(p.tolerancia); setSuavizado(p.suavizado); setInterior(p.interior); setDegradado(p.degradado);
  }

  // Ajustes sugeridos por el análisis de la imagen.
  const sug = analisis ? analisis.sugerencia.fondo : null;
  function usarSugerencia() {
    if (!sug) return;
    setModo(sug.modo); elegirPreset(sug.preset); setTolerancia(sug.tolerancia);
    setPincel(sug.modo === 'sujeto' ? 'caja' : 'nada');
  }
  useEffect(() => { usarSugerencia(); }, [analisis]); // eslint-disable-line react-hooks/exhaustive-deps

  function cambiarModo(m) { setModo(m); setRes(null); setPincel(m === 'sujeto' ? (SELECCION.includes(pincel) ? pincel : 'caja') : 'nada'); }

  function quitarSeleccion() { setCaja(null); setLazo(LAZO_VACIO); setVivo([]); trazoLibre.current = []; }

  async function quitar(extra = {}) {
    setError('');
    try {
      const r = modo === 'sujeto'
        ? await ejecutar('sujeto', { img, mask: marcas.current, opts: lazo.cerrado ? { suavizado, contraer, silueta: mascaraSilueta(lazo.tramos, img.width, img.height) } : { suavizado, contraer, caja } }, 'Recortando el sujeto…')
        : await ejecutar('fondo', { img, opts: { modo, tolerancia, suavizado, contraer, interior, degradado, conectado, ...extra } }, 'Quitando el fondo…');
      setRes({ img: { data: r.data, width: r.width, height: r.height }, alfa: r.alfa });
      deshacer.current = [];
      if (modo !== 'sujeto') setPincel('nada');
    } catch (e) { setError(e.message); }
  }

  // ---- Lazo magnético: cada clic fija un punto y la línea se pega al borde de la imagen ----
  function preparar() {
    if (prepLazo.current.img !== img) prepLazo.current = { img, prep: prepararLazo(img) };
    return prepLazo.current.prep;
  }
  function cerrarLazo() {
    const l = lazoRef.current;
    if (l.cerrado || l.anchors.length < 3) return;
    const prep = preparar(), a = l.anchors[l.anchors.length - 1], b = l.anchors[0];
    setLazo({ ...l, tramos: [...l.tramos, trazarLazo(prep, a[0], a[1], b[0], b[1])], cerrado: true });
    setVivo([]); setRes(null); setCaja(null);
  }
  function clicLazo(x, y, z) {
    const l = lazoRef.current;
    if (l.cerrado) return;
    const prep = preparar();
    if (l.anchors.length >= 3 && Math.hypot(x - l.anchors[0][0], y - l.anchors[0][1]) <= 12 / z) { cerrarLazo(); return; }
    const p = ajustarPunto(prep, x, y, 8 / z);
    if (!l.anchors.length) { setLazo({ ...l, anchors: [p] }); return; }
    const a = l.anchors[l.anchors.length - 1];
    setLazo({ ...l, anchors: [...l.anchors, p], tramos: [...l.tramos, trazarLazo(prep, a[0], a[1], p[0], p[1])] });
    setVivo([]);
  }
  function deshacerPunto() {
    const l = lazoRef.current;
    setVivo([]);
    if (l.cerrado) { setLazo({ ...l, tramos: l.tramos.slice(0, -1), cerrado: false }); return; }
    setLazo({ anchors: l.anchors.slice(0, -1), tramos: l.tramos.slice(0, -1), cerrado: false });
  }
  function alMover(x, y, z) {
    const l = lazoRef.current;
    if (pincel !== 'lazo' || !l.anchors.length || l.cerrado) return;
    const primera = !hoverPend.current;
    hoverPend.current = { x, y, z };
    if (!primera) return;
    requestAnimationFrame(() => {
      const h = hoverPend.current; hoverPend.current = null;
      const ll = lazoRef.current;
      if (!h || !ll.anchors.length || ll.cerrado) return;
      const prep = preparar(), a = ll.anchors[ll.anchors.length - 1];
      const p = ajustarPunto(prep, h.x, h.y, 8 / h.z);
      setVivo(trazarLazo(prep, a[0], a[1], p[0], p[1]));
    });
  }

  // Zona donde el usuario encerró al sujeto: recuadro, lazo libre o silueta. Devuelve la caja que la contiene.
  function zonaSeleccionada() {
    const { width: W, height: H } = img;
    if (lazo.cerrado) {
      let x0 = W, y0 = H, x1 = 0, y1 = 0;
      for (const t of lazo.tramos) for (const [x, y] of t) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const m = Math.round(Math.max(W, H) * 0.03); // un poco de aire para que el modelo vea el borde completo
      const a = Math.max(0, Math.floor(x0 - m)), b = Math.max(0, Math.floor(y0 - m));
      return { caja: { x: a, y: b, w: Math.min(W, Math.ceil(x1 + m)) - a, h: Math.min(H, Math.ceil(y1 + m)) - b }, poligono: true };
    }
    if (caja && caja.w >= 12 && caja.h >= 12) return { caja, poligono: false };
    return null;
  }

  // Recorte de precisión: un clic. Si el usuario encerró al sujeto, el modelo trabaja solo dentro de esa zona
  // (la ve más grande y no se distrae con el resto) y fuera de ella todo queda transparente.
  async function precision() {
    setError('');
    try {
      const zona = zonaSeleccionada();
      if (!zona) {
        const r = await ejecutar('precision', { img, opts: { suavizado, contraer } }, 'Recortando con precisión…');
        setRes({ img: { data: r.data, width: r.width, height: r.height }, alfa: r.alfa });
      } else {
        const { width: W, height: H } = img, c = zona.caja;
        const r = await ejecutar('precision', { img: recortar(img, c), opts: { suavizado, contraer } }, 'Recortando con precisión…');
        const data = new Uint8ClampedArray(img.data), alfa = new Uint8Array(W * H);
        for (let i = 0; i < W * H; i++) data[i * 4 + 3] = 0;
        const mascara = zona.poligono ? mascaraSilueta(lazo.tramos, W, H, Math.max(4, Math.round(Math.max(W, H) * 0.012) * 2)) : null;
        for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
          const si = y * c.w + x, gi = (y + c.y) * W + x + c.x;
          const a = mascara && !mascara[gi] ? 0 : r.alfa[si];
          alfa[gi] = a;
          if (a) { data[gi * 4] = r.data[si * 4]; data[gi * 4 + 1] = r.data[si * 4 + 1]; data[gi * 4 + 2] = r.data[si * 4 + 2]; data[gi * 4 + 3] = a; }
        }
        setRes({ img: { data, width: W, height: H }, alfa });
      }
      deshacer.current = [];
      setPincel('restaurar');
    } catch (e) { setError(e.message); }
  }

  // Lazo libre: se dibuja a mano alzada alrededor del sujeto y se cierra solo al soltar.
  function dibujarLibre(c, d) {
    const pts = trazoLibre.current, paso = Math.max(2, Math.max(img.width, img.height) / 300);
    const u = pts[pts.length - 1];
    if (u && Math.hypot(c - u[0], d - u[1]) < paso) return;
    pts.push([Math.max(0, Math.min(img.width, c)), Math.max(0, Math.min(img.height, d))]);
    if (pts.length === 1) { setCaja(null); setRes(null); }
    setLazo({ anchors: [pts[0]], tramos: [[...pts]], cerrado: false });
  }

  function alHacerClic(x, y, z) {
    if (pincel === 'lazo') { clicLazo(x, y, z); return; }
    if (modo !== 'color') return;
    const i = (y * img.width + x) * 4;
    quitar({ color: [img.data[i], img.data[i + 1], img.data[i + 2]], semilla: { x, y } });
  }

  // ---- Pincel: marcas (verde/rojo) o retoque directo del resultado ----
  function pintarMarca(x0, y0, x1, y1) {
    const m = marcas.current;
    if (!m) return;
    const { width: w, height: h } = img;
    const v = pincel === 'conservar' ? 1 : pincel === 'quitar' ? 2 : 0;
    const o = visor.current && visor.current.overlay();
    if (o) {
      o.save();
      o.globalCompositeOperation = v ? 'source-over' : 'destination-out';
      o.strokeStyle = COLOR_MARCA[pincel] || '#000';
      o.lineWidth = radio * 2; o.lineCap = 'round'; o.lineJoin = 'round';
      o.beginPath(); o.moveTo(x0, y0); o.lineTo(x1 + 0.01, y1 + 0.01); o.stroke();
      o.restore();
    }
    const pasos = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(1, radio / 3)));
    const r2 = radio * radio;
    for (let s = 0; s <= pasos; s++) {
      const cx = x0 + ((x1 - x0) * s) / pasos, cy = y0 + ((y1 - y0) * s) / pasos;
      const ax = Math.max(0, Math.floor(cx - radio)), bx = Math.min(w - 1, Math.ceil(cx + radio));
      const ay = Math.max(0, Math.floor(cy - radio)), by = Math.min(h - 1, Math.ceil(cy + radio));
      for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r2) m[y * w + x] = v;
      }
    }
  }
  function contarMarcas() {
    const m = marcas.current;
    let c = 0, q = 0;
    if (m) for (let i = 0; i < m.length; i++) { if (m[i] === 1) c++; else if (m[i] === 2) q++; }
    setNMarcas({ conservar: c, quitar: q });
  }
  function limpiarMarcas() {
    marcas.current = new Uint8Array(img.width * img.height);
    visor.current && visor.current.limpiarMarcas();
    setNMarcas({ conservar: 0, quitar: 0 });
  }

  function retocar(x0, y0, x1, y1) {
    if (!res) return;
    const { width: w, height: h } = res.img;
    if (!idRef.current || idRef.current.data !== res.img.data) idRef.current = new ImageData(res.img.data, w, h);
    const v = pincel === 'borrar' ? 0 : 255;
    const pasos = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(1, radio / 3)));
    const r2 = radio * radio;
    let minx = w, miny = h, maxx = 0, maxy = 0;
    for (let s = 0; s <= pasos; s++) {
      const cx = x0 + ((x1 - x0) * s) / pasos, cy = y0 + ((y1 - y0) * s) / pasos;
      const ax = Math.max(0, Math.floor(cx - radio)), bx = Math.min(w - 1, Math.ceil(cx + radio));
      const ay = Math.max(0, Math.floor(cy - radio)), by = Math.min(h - 1, Math.ceil(cy + radio));
      for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        const i = y * w + x;
        res.alfa[i] = v;
        res.img.data[i * 4 + 3] = v === 0 ? 0 : img.data[i * 4 + 3];
      }
      if (ax < minx) minx = ax; if (ay < miny) miny = ay; if (bx > maxx) maxx = bx; if (by > maxy) maxy = by;
    }
    const ctx = visor.current && visor.current.ctx();
    if (ctx) ctx.putImageData(idRef.current, 0, 0, minx, miny, maxx - minx + 1, maxy - miny + 1);
  }

  function dibujarCaja(a, b, c, d) {
    if (!inicioCaja.current) inicioCaja.current = { x: a, y: b };
    const { x, y } = inicioCaja.current;
    const x0 = Math.max(0, Math.min(x, c)), y0 = Math.max(0, Math.min(y, d));
    const x1 = Math.min(img.width, Math.max(x, c)), y1 = Math.min(img.height, Math.max(y, d));
    setCaja({ x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) });
  }

  function pintar(a, b, c, d) {
    if (pincel === 'caja') { dibujarCaja(a, b, c, d); return; }
    if (pincel === 'libre') { dibujarLibre(c, d); return; }
    if (ES_MARCA.includes(pincel)) { pintarMarca(a, b, c, d); return; }
    if (!pintandoInicio.current) {
      pintandoInicio.current = true;
      deshacer.current.push(new Uint8Array(res.alfa));
      if (deshacer.current.length > 6) deshacer.current.shift();
    }
    retocar(a, b, c, d);
  }
  function finTrazo() {
    pintandoInicio.current = false;
    if (pincel === 'caja') {
      inicioCaja.current = null;
      setCaja((c) => (c && (c.w < 12 || c.h < 12) ? null : c)); // un clic suelto no es un recuadro
      setLazo(LAZO_VACIO);
      return;
    }
    if (pincel === 'libre') {
      const pts = trazoLibre.current; trazoLibre.current = [];
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const ok = pts.length >= 8 && Math.max(...xs) - Math.min(...xs) >= 12 && Math.max(...ys) - Math.min(...ys) >= 12;
      setLazo(ok ? { anchors: [pts[0]], tramos: [[...pts, pts[0]]], cerrado: true } : LAZO_VACIO); // un trazo corto no es una selección
      return;
    }
    if (ES_MARCA.includes(pincel)) contarMarcas(); else setVersion((n) => n + 1);
  }
  function deshacerRetoque() {
    const a = deshacer.current.pop();
    if (!a || !res) return;
    const d = res.img.data;
    for (let i = 0; i < a.length; i++) { res.alfa[i] = a[i]; d[i * 4 + 3] = a[i] === 0 ? 0 : img.data[i * 4 + 3]; }
    const ctx = visor.current && visor.current.ctx();
    if (ctx) ctx.putImageData(new ImageData(d, res.img.width, res.img.height), 0, 0);
    setVersion((n) => n + 1);
  }

  function resultadoFinal() {
    if (!res) return null;
    if (!recorta) return res.img;
    const caja = cajaDeContenido(res.img);
    return caja ? recortar(res.img, caja) : res.img;
  }
  async function bajar() {
    descargar(await aBlob(resultadoFinal(), 'image/png'), `${nombreBase(doc.nombre)}-sin-fondo.png`);
  }

  const esArrastre = pincel === 'caja' || pincel === 'libre'; // se dibujan arrastrando, sin círculo de pincel
  const pincelActivo = pincel !== 'nada' && pincel !== 'lazo' && (ES_MARCA.includes(pincel) ? modo === 'sujeto' : esArrastre ? true : !!res);
  const vista = res ? res.img : img;
  const hayMarcas = nMarcas.conservar + nMarcas.quitar > 0;
  const mostrarCaja = caja && (!res || pincel === 'caja');
  const hayZona = !!caja || lazo.anchors.length > 0;

  return (
    <div className="herramienta">
      <div data-guide="visor">
        <Visor
          ref={visor}
          img={vista}
          pincel={pincelActivo ? { radio, rect: esArrastre } : undefined}
          caja={mostrarCaja ? caja : undefined}
          lazo={lazo.anchors.length && (!res || pincel === 'lazo' || pincel === 'libre') ? { ...lazo, vivo } : undefined}
          onHover={pincel === 'lazo' ? alMover : undefined}
          onPintar={pintar}
          onFinTrazo={finTrazo}
          onClic={!pincelActivo ? alHacerClic : undefined}
        >
          {res && (
            <button data-guide="deshacer-retoque" className="btn btn-contorno btn-sm" onClick={deshacerRetoque} disabled={!deshacer.current.length}><Icon name="undo" size={15} />Deshacer retoque</button>
          )}
        </Visor>
        {modo === 'color' && !res && <div className="ayuda" style={{ marginTop: 8 }}>Haz clic en la imagen sobre el color que quieres quitar.</div>}
        {modo === 'sujeto' && (
          <div className="ayuda" style={{ marginTop: 8 }}>
            Paso 1: encierra al sujeto con <b>Recuadro</b>, a mano alzada (<b>A mano</b>) o punto a punto sobre su contorno (<b>Silueta</b>, la más exacta). Paso 2: corrige con <b style={{ color: 'var(--exito)' }}>verde</b> lo que falte y <b style={{ color: 'var(--error)' }}>rojo</b> lo que sobre.
          </div>
        )}
      </div>

      <Panel data-guide="panel">
        <Sugerencia analisis={analisis} onAplicar={usarSugerencia} lineas={sug ? [analisis.sugerencia.resumen[0], sug.porQue] : []} />

        <Seccion titulo="Recorte de precisión">
          <span className="ayuda">Separa al sujeto del fondo, incluso con pelo, vidrio o fondos con detalle. Para más exactitud, primero encierra el objeto: así solo se analiza esa zona. La primera vez descarga un componente de unos 200 MB; después queda guardado en tu navegador. Un recorte tarda de 15 a 60 segundos según el equipo.</span>
          <div data-guide="marcas" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Segmentos etiqueta="Encerrar el objeto" value={SELECCION.includes(pincel) ? pincel : ''} onChange={setPincel} opciones={[['caja', 'Recuadro'], ['libre', 'A mano'], ['lazo', 'Silueta']]} />
          </div>
          <span className="ayuda">
            {pincel === 'caja' && 'Recuadro: arrastra para encerrar el objeto, sin apretarlo demasiado.'}
            {pincel === 'libre' && 'A mano: dibuja libremente una línea alrededor del objeto; se cierra sola al soltar.'}
            {pincel === 'lazo' && 'Silueta: haz clic en puntos a lo largo del contorno; la línea se pega sola al borde. Cierra con un clic sobre el punto dorado o con el botón.'}
            {!SELECCION.includes(pincel) && 'Elige una forma para encerrar el objeto (opcional).'}
          </span>
          {pincel === 'lazo' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-contorno btn-sm" onClick={cerrarLazo} disabled={lazo.cerrado || lazo.anchors.length < 3}><Icon name="check" size={14} />Cerrar silueta</button>
              <button className="btn btn-contorno btn-sm" onClick={deshacerPunto} disabled={!lazo.anchors.length}><Icon name="undo" size={14} />Deshacer punto</button>
            </div>
          )}
          <button data-guide="precision" className="btn btn-primario" style={{ minHeight: 42 }} onClick={precision}><Icon name="sparkles" size={17} />{zonaSeleccionada() ? 'Recortar dentro de la selección' : 'Recortar con precisión'}</button>
          {hayZona && <button className="btn btn-fantasma btn-sm" style={{ alignSelf: 'flex-start' }} onClick={quitarSeleccion}><Icon name="x" size={14} />Quitar selección</button>}
        </Seccion>

        <Seccion titulo="O elige cómo detectar el fondo">
          <div data-guide="modo">
            <Segmentos etiqueta="Método" value={modo} onChange={cambiarModo} opciones={[['sujeto', 'Marcar sujeto'], ['bordes', 'Automático'], ['color', 'Por color']]} />
          </div>
          <span className="ayuda">
            {modo === 'sujeto' && 'Recomendado para fotos y fondos con detalle. Dibuja un recuadro alrededor de la persona u objeto y la app encuentra su contorno; luego corriges con marcas verde y rojo.'}
            {modo === 'bordes' && 'Toma el color de los bordes de la imagen y lo quita hacia adentro. Sirve para fondos lisos.'}
            {modo === 'color' && 'Haz clic sobre el color a quitar. Funciona con fondos de un solo color.'}
          </span>
          {modo === 'bordes' && <Segmentos etiqueta="Tipo de imagen" value={preset} onChange={elegirPreset} opciones={PRESETS.map(([k, t]) => [k, t])} />}
        </Seccion>

        {modo === 'sujeto' && (
          <Seccion titulo="Marcas">
            <Segmentos etiqueta="Corregir con marcas" value={ES_MARCA.includes(pincel) ? pincel : ''} onChange={setPincel} opciones={[['conservar', 'Verde'], ['quitar', 'Rojo'], ['borrarMarca', 'Borrar']]} />
            <span className="ayuda">Para el método «Marcar sujeto»: encierra el objeto arriba (recuadro, a mano o silueta) y corrige aquí. Verde: conservar. Rojo: quitar.</span>
            {ES_MARCA.includes(pincel) && <Deslizador label="Tamaño del pincel" value={radio} min={2} max={120} onChange={setRadio} formato={(v) => `${v} px`} />}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="chip-info"><Icon name="crop" size={12} />Recuadro: {caja ? 'puesto' : 'sin poner'}</span>
              <span className="chip-info"><Icon name="scissors" size={12} />Silueta: {lazo.cerrado ? 'cerrada' : lazo.anchors.length ? `${lazo.anchors.length} puntos` : 'sin trazar'}</span>
              <span className="chip-info"><span style={{ width: 10, height: 10, borderRadius: 5, background: 'var(--exito)' }} />Conservar: {nMarcas.conservar ? 'marcado' : 'sin marcar'}</span>
              <span className="chip-info"><span style={{ width: 10, height: 10, borderRadius: 5, background: 'var(--error)' }} />Quitar: {nMarcas.quitar ? 'marcado' : 'sin marcar'}</span>
            </div>
            {(hayMarcas || caja || lazo.anchors.length > 0) && <button className="btn btn-fantasma btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => { limpiarMarcas(); quitarSeleccion(); }}><Icon name="x" size={14} />Quitar selección y marcas</button>}
          </Seccion>
        )}

        <Seccion titulo="Ajustes">
          {modo !== 'sujeto' && <div data-guide="tolerancia"><Deslizador label="Tolerancia de color" value={tolerancia} min={1} onChange={(v) => { setTolerancia(v); setPreset(''); }} ayuda="Súbela si quedan restos del fondo; bájala si se está comiendo parte del objeto." /></div>}
          <Deslizador label="Suavizado del borde" value={suavizado} min={0} max={4} onChange={setSuavizado} formato={(v) => ['Ninguno', 'Poco', 'Medio', 'Alto', 'Muy alto'][v]} />
          <Deslizador label="Borde" value={contraer} min={-3} max={3} onChange={setContraer} formato={(v) => (v === 0 ? 'Normal' : v > 0 ? `Contraer ${v} px` : `Expandir ${-v} px`)} ayuda="Contraer elimina el halo claro que a veces queda alrededor." />
          {modo === 'bordes' && <Casilla checked={interior} onChange={setInterior} ayuda="Quita el fondo que quedó encerrado, como el hueco de una «O». Evítalo si el objeto tiene partes del mismo color que el fondo.">Quitar zonas interiores</Casilla>}
          {modo === 'bordes' && <Casilla checked={degradado} onChange={setDegradado}>El fondo tiene degradado o sombra suave</Casilla>}
          {modo === 'color' && <Casilla checked={conectado} onChange={setConectado} ayuda="Si lo desmarcas, quita ese color en toda la imagen.">Solo la zona conectada al clic</Casilla>}
        </Seccion>

        {error && <Aviso tipo="error">{error}</Aviso>}

        {(modo !== 'color' || res) && (
          <button data-guide="accion" className="btn btn-primario" style={{ minHeight: 42 }} onClick={() => quitar()}>
            <Icon name="scissors" size={17} />{modo === 'sujeto' ? (res ? 'Recortar de nuevo con las marcas' : 'Recortar sujeto') : (res ? 'Volver a quitar el fondo' : 'Quitar fondo')}
          </button>
        )}
        {modo === 'sujeto' && !res && lazo.cerrado && <Aviso>Silueta cerrada. Pulsa «Recortar sujeto»: lo de dentro se conserva, lo de fuera se quita y la app solo decide la franja pegada a la línea.</Aviso>}
        {modo === 'sujeto' && !res && !hayMarcas && !caja && !lazo.anchors.length && <Aviso>Empieza arrastrando un recuadro sobre la imagen que encierre al sujeto, sin apretarlo demasiado. Si no dibujas nada, hago una detección automática con lo que más destaca (es un borrador; las partes claras o transparentes suelen necesitar marcas verdes).</Aviso>}
        {modo === 'sujeto' && !res && !hayMarcas && caja && !lazo.cerrado && <Aviso>Recuadro listo. Pulsa «Recortar sujeto». Todo lo que queda fuera del recuadro se descarta y dentro la app separa al sujeto del fondo.</Aviso>}
        {modo === 'sujeto' && res && <Aviso>¿Falta algo o sobra algo? Marca esa zona (verde si falta, rojo si sobra) y recorta de nuevo; las marcas anteriores se conservan. Para vidrio o partes casi del color del fondo, marca su contorno en verde.</Aviso>}

        {res && (
          <>
            <Seccion titulo="Retoque final">
              <div data-guide="pincel"><Segmentos etiqueta="Pincel de retoque" value={['borrar', 'restaurar'].includes(pincel) ? pincel : ''} onChange={setPincel} opciones={[['borrar', 'Borrar'], ['restaurar', 'Restaurar']]} /></div>
              {['borrar', 'restaurar'].includes(pincel) && <Deslizador label="Tamaño del pincel" value={radio} min={2} max={120} onChange={setRadio} formato={(v) => `${v} px`} />}
              <span className="ayuda">Corrige a mano el resultado: «Borrar» hace transparente lo que pintes; «Restaurar» recupera lo que se quitó de más. Haz zoom para mayor precisión.</span>
            </Seccion>
            <Seccion titulo="Resultado">
              <Casilla checked={recorta} onChange={setRecorta}>Recortar el espacio vacío alrededor</Casilla>
              <div data-guide="resultado" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button className="btn btn-contorno" onClick={() => aplicar(resultadoFinal(), 'Quitar fondo')}><Icon name="check" size={16} />Usar como imagen de trabajo</button>
                <button className="btn btn-contorno" onClick={bajar}><Icon name="download" size={16} />Descargar PNG transparente</button>
              </div>
            </Seccion>
          </>
        )}
      </Panel>
    </div>
  );
}
