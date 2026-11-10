import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Icon from './Icon';

// Visor de imagen sobre fondo de damero (para ver transparencias), con zoom y, opcionalmente, un pincel
// (`pincel` = { radio } → llama a onPintar en cada tramo del trazo).
// Por la ref expone: ctx() (lienzo de la imagen), overlay() (lienzo de marcas encima), limpiarMarcas().
// `caja` = { x, y, w, h } en píxeles de la imagen: recuadro punteado que se dibuja encima.
// `lazo` = { tramos: [[[x,y]…]…], vivo: [[x,y]…], anchors: [[x,y]…] }: contorno del lazo magnético. `onHover(x, y)` avisa del cursor sin pincel.
const Visor = forwardRef(function Visor({ img, base, pincel, caja, lazo, onHover, onPintar, onFinTrazo, onClic, alto = '62vh', children }, ref) {
  const cont = useRef(null);
  const lienzo = useRef(null);
  const marcas = useRef(null);
  const aro = useRef(null);
  const [zoom, setZoom] = useState('fit');
  const [ajuste, setAjuste] = useState(1);
  const pintando = useRef(false);
  const ultimo = useRef(null);

  const bw = base ? base.w : img ? img.width : 1;
  const bh = base ? base.h : img ? img.height : 1;

  const medir = useCallback(() => {
    if (!cont.current) return;
    const cw = cont.current.clientWidth - 2, ch = cont.current.clientHeight - 2;
    setAjuste(Math.min(1, cw / bw, ch / bh) || 1);
  }, [bw, bh]);
  useEffect(() => {
    medir();
    const ro = new ResizeObserver(medir);
    if (cont.current) ro.observe(cont.current);
    return () => ro.disconnect();
  }, [medir]);

  const z = zoom === 'fit' ? ajuste : zoom;

  // Pinta la imagen en el lienzo cada vez que cambia.
  useEffect(() => {
    if (!img || !lienzo.current) return;
    const c = lienzo.current;
    if (c.width !== img.width || c.height !== img.height) { c.width = img.width; c.height = img.height; }
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  }, [img]);

  useEffect(() => {
    const o = marcas.current;
    if (o && (o.width !== bw || o.height !== bh)) { o.width = bw; o.height = bh; }
  }, [img, bw, bh]);

  useImperativeHandle(ref, () => ({
    ctx: () => lienzo.current && lienzo.current.getContext('2d'),
    overlay: () => marcas.current && marcas.current.getContext('2d'),
    limpiarMarcas: () => { const o = marcas.current; if (o) o.getContext('2d').clearRect(0, 0, o.width, o.height); },
  }));

  const aImagen = (e) => {
    const r = lienzo.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * bw) / r.width, y: ((e.clientY - r.top) * bh) / r.height };
  };

  const mueveAro = (e) => {
    if (!aro.current || !pincel) return;
    const r = lienzo.current.getBoundingClientRect();
    if (pincel.rect) return;
    const d = pincel.radio * 2 * (r.width / bw);
    const a = aro.current;
    a.style.width = a.style.height = d + 'px';
    a.style.left = e.clientX - r.left - d / 2 + 'px';
    a.style.top = e.clientY - r.top - d / 2 + 'px';
    a.style.display = 'block';
  };

  const down = (e) => {
    if (!img) return;
    if (!pincel) {
      if (onClic) { const p = aImagen(e); onClic(Math.floor(p.x), Math.floor(p.y), z); }
      return;
    }
    e.preventDefault();
    lienzo.current.setPointerCapture?.(e.pointerId);
    pintando.current = true;
    const p = aImagen(e);
    ultimo.current = p;
    onPintar(p.x, p.y, p.x, p.y);
  };
  const move = (e) => {
    if (pincel) mueveAro(e);
    else if (onHover) { const p = aImagen(e); onHover(p.x, p.y, z); }
    if (!pintando.current) return;
    const p = aImagen(e);
    onPintar(ultimo.current.x, ultimo.current.y, p.x, p.y);
    ultimo.current = p;
  };
  const up = () => {
    if (!pintando.current) return;
    pintando.current = false;
    onFinTrazo && onFinTrazo();
  };

  if (!img) return null;
  const cssW = bw * z, cssH = bh * z;
  const btn = { width: 34, height: 34, padding: 0 };
  const contW = cont.current ? cont.current.clientWidth : 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <button className="btn btn-contorno btn-sm" style={btn} onClick={() => setZoom(Math.max(0.05, +(z / 1.25).toFixed(3)))} aria-label="Alejar" title="Alejar"><Icon name="minus" size={16} /></button>
        <button className="btn btn-contorno btn-sm" style={{ minWidth: 64 }} onClick={() => setZoom('fit')} title="Ajustar al visor">{Math.round(z * 100)}%</button>
        <button className="btn btn-contorno btn-sm" style={btn} onClick={() => setZoom(Math.min(8, +(z * 1.25).toFixed(3)))} aria-label="Acercar" title="Acercar"><Icon name="plus" size={16} /></button>
        <button className="btn btn-fantasma btn-sm" onClick={() => setZoom(1)} title="Tamaño real">100%</button>
        <span style={{ flex: 1 }} />
        {children}
      </div>
      <div ref={cont} className="damero" style={{ border: '1px solid var(--borde)', borderRadius: 12, overflow: 'auto', height: alto, minHeight: 240 }}>
        <div
          style={{ position: 'relative', width: cssW, height: cssH, margin: cssW < contW ? '0 auto' : 0, cursor: pincel ? (pincel.rect ? 'crosshair' : 'none') : onClic ? 'crosshair' : 'default' }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          onPointerLeave={() => { if (aro.current) aro.current.style.display = 'none'; }}
        >
          <canvas ref={lienzo} style={{ width: cssW, height: cssH, display: 'block', imageRendering: z > 2 ? 'pixelated' : 'auto', touchAction: pincel ? 'none' : 'auto' }} />
          <canvas ref={marcas} style={{ position: 'absolute', left: 0, top: 0, width: cssW, height: cssH, pointerEvents: 'none' }} />
          {caja && (
            <div style={{
              position: 'absolute', left: caja.x * z, top: caja.y * z, width: caja.w * z, height: caja.h * z,
              border: '2px dashed #fff', boxShadow: '0 0 0 1.5px var(--morado), 0 0 0 9999px rgba(40,10,60,.38)',
              pointerEvents: 'none', boxSizing: 'border-box',
            }} />
          )}
          {lazo && (
            <svg width={cssW} height={cssH} viewBox={`0 0 ${bw} ${bh}`} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', overflow: 'visible' }}>
              {[...lazo.tramos, ...(lazo.vivo && lazo.vivo.length ? [lazo.vivo] : [])].map((t, i) => {
                const pts = t.map((p) => p.join(',')).join(' ');
                return (
                  <g key={i}>
                    <polyline points={pts} fill="none" stroke="#fff" strokeWidth={3.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                    <polyline points={pts} fill="none" stroke="#7C07A6" strokeWidth={1.8} strokeDasharray="5 4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  </g>
                );
              })}
              {lazo.anchors.map((p, i) => (
                <circle key={i} cx={p[0]} cy={p[1]} r={(i === 0 ? 6 : 4) / z} fill={i === 0 ? '#E0A526' : '#fff'} stroke="#7C07A6" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
          )}
          {pincel && !pincel.rect && <div ref={aro} style={{ position: 'absolute', display: 'none', border: '2px solid #fff', boxShadow: '0 0 0 1.5px var(--morado)', borderRadius: '50%', pointerEvents: 'none' }} />}
        </div>
      </div>
    </div>
  );
});

export default Visor;
