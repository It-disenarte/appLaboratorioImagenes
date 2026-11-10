import { useEffect, useRef, useState } from 'react';
import Visor from '../Visor';
import { Deslizador, Segmentos, Panel, Seccion, Aviso, Icon } from '../ui';

export default function Objetos({ doc, ejecutar, aplicar, deshacer, puedeDeshacer }) {
  const img = doc.img;
  const visor = useRef(null);
  const mascara = useRef(null);
  const [radio, setRadio] = useState(20);
  const [modo, setModo] = useState('marcar'); // marcar | borrar
  const [calidad, setCalidad] = useState(2);
  const [expandir, setExpandir] = useState(2);
  const [marcado, setMarcado] = useState(false);
  const [error, setError] = useState('');

  // Máscara nueva (y marcas limpias) cada vez que cambia la imagen.
  useEffect(() => {
    mascara.current = new Uint8Array(img.width * img.height);
    setMarcado(false); setError('');
    if (visor.current) visor.current.limpiarMarcas();
  }, [img]);

  function pintar(x0, y0, x1, y1) {
    const m = mascara.current;
    if (!m) return;
    const { width: w, height: h } = img;
    const v = modo === 'marcar' ? 255 : 0;
    // Marcas visibles
    const o = visor.current && visor.current.overlay();
    if (o) {
      o.save();
      o.globalCompositeOperation = v ? 'source-over' : 'destination-out';
      o.strokeStyle = 'rgba(179,38,30,0.55)'; o.fillStyle = 'rgba(179,38,30,0.55)';
      o.lineWidth = radio * 2; o.lineCap = 'round'; o.lineJoin = 'round';
      o.beginPath(); o.moveTo(x0, y0); o.lineTo(x1 + 0.01, y1 + 0.01); o.stroke();
      o.restore();
    }
    // Máscara real
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

  function hayMarcas() {
    const m = mascara.current;
    if (!m) return false;
    for (let i = 0; i < m.length; i++) if (m[i]) return true;
    return false;
  }

  function limpiar() {
    mascara.current = new Uint8Array(img.width * img.height);
    visor.current && visor.current.limpiarMarcas();
    setMarcado(false);
  }

  async function eliminar() {
    setError('');
    if (!hayMarcas()) { setError('Primero pinta con el pincel lo que quieres eliminar.'); return; }
    try {
      const r = await ejecutar('objetos', { img, mask: mascara.current, opts: { calidad, expandir } }, 'Eliminando lo marcado…');
      aplicar(r, 'Eliminar objeto');
    } catch (e) { setError(e.message); }
  }

  // Relleno de precisión: para objetos grandes o texturas complejas, o cuando el resultado rápido no convence.
  async function eliminarPrecision() {
    setError('');
    if (!hayMarcas()) { setError('Primero pinta con el pincel lo que quieres eliminar.'); return; }
    try {
      const r = await ejecutar('objetosPrecision', { img, mask: mascara.current, opts: { expandir } }, 'Eliminando con precisión…');
      aplicar(r, 'Eliminar objeto (precisión)');
    } catch (e) { setError(e.message); }
  }

  return (
    <div className="herramienta">
      <div data-guide="visor">
        <Visor ref={visor} img={img} pincel={{ radio }} onPintar={pintar} onFinTrazo={() => setMarcado(hayMarcas())} />
        <div className="ayuda" style={{ marginTop: 8 }}>Pinta encima de lo que quieres quitar (se marca en rojo). Haz zoom para marcar con precisión.</div>
      </div>

      <Panel data-guide="panel">
        <Seccion titulo="Pincel">
          <div data-guide="pincel"><Segmentos etiqueta="Modo del pincel" value={modo} onChange={setModo} opciones={[['marcar', 'Marcar'], ['borrar', 'Borrar marca']]} /></div>
          <Deslizador label="Tamaño del pincel" value={radio} min={2} max={150} onChange={setRadio} formato={(v) => `${v} px`} />
        </Seccion>

        <Seccion titulo="Relleno">
          <Deslizador label="Calidad del relleno" value={calidad} min={1} max={4} onChange={setCalidad} formato={(v) => ['', 'Rápida', 'Normal', 'Alta', 'Máxima'][v]} ayuda="Más calidad tarda más. Para objetos grandes o texturas complejas usa Alta." />
          <Deslizador label="Ampliar la marca" value={expandir} min={0} max={8} onChange={setExpandir} formato={(v) => `${v} px`} ayuda="Cubre los bordes y sombras que quedan pegados al objeto." />
        </Seccion>

        {error && <Aviso tipo="error">{error}</Aviso>}

        <Seccion>
          <button data-guide="accion" className="btn btn-primario" style={{ minHeight: 42 }} onClick={eliminar}><Icon name="eraser" size={17} />Eliminar lo marcado</button>
          <button data-guide="precision" className="btn btn-primario" style={{ minHeight: 42 }} onClick={eliminarPrecision}><Icon name="sparkles" size={17} />Eliminar con precisión</button>
          <span className="ayuda">«Eliminar con precisión» reconstruye mejor lo que había detrás, también en objetos grandes o fondos con detalle. La primera vez descarga un componente de unos 200 MB; después queda guardado en tu navegador. Tarda de 20 a 90 segundos según el equipo.</span>
          <button className="btn btn-contorno" onClick={limpiar} disabled={!marcado}><Icon name="x" size={16} />Quitar todas las marcas</button>
          <button data-guide="deshacer" className="btn btn-contorno" onClick={deshacer} disabled={!puedeDeshacer}><Icon name="undo" size={16} />Deshacer el último cambio</button>
          <Aviso>Funciona mejor cuando alrededor hay fondo parecido (cielo, pared, pasto, textura). No inventa lo que no existe: para quitar objetos grandes sobre zonas muy distintas, repite por partes.</Aviso>
        </Seccion>
      </Panel>
    </div>
  );
}
