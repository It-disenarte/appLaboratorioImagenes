import Icon from './Icon';

// Piezas pequeñas compartidas por las herramientas.

export function Deslizador({ label, value, onChange, min = 0, max = 100, step = 1, ayuda, formato, disabled }) {
  return (
    <label className="etiqueta-campo">
      <span>{label}<span className="valor">{formato ? formato(value) : value}</span></span>
      <input className="slider" type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
      {ayuda && <span className="ayuda">{ayuda}</span>}
    </label>
  );
}

export function Segmentos({ opciones, value, onChange, etiqueta }) {
  return (
    <div className="seg" role="group" aria-label={etiqueta}>
      {opciones.map(([k, texto, desactivado]) => (
        <button key={k} type="button" aria-pressed={value === k} disabled={desactivado} onClick={() => onChange(k)} style={desactivado ? { opacity: 0.4, cursor: 'default' } : undefined}>{texto}</button>
      ))}
    </div>
  );
}

export function Casilla({ checked, onChange, children, ayuda }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}{ayuda && <span className="ayuda" style={{ display: 'block' }}>{ayuda}</span>}</span>
    </label>
  );
}

export function Seccion({ titulo, children, ...rest }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} {...rest}>
      {titulo && <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--texto-3)' }}>{titulo}</div>}
      {children}
    </div>
  );
}

export function Panel({ children, ...rest }) {
  return <aside className="tarjeta panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 18 }} {...rest}>{children}</aside>;
}

export function Aviso({ children, tipo = 'info' }) {
  const colores = tipo === 'error' ? ['var(--error-fondo)', 'var(--error)'] : ['#F3EAF8', 'var(--texto-2)'];
  return <div role={tipo === 'error' ? 'alert' : 'note'} style={{ background: colores[0], color: colores[1], borderRadius: 8, padding: '9px 12px', fontSize: 13, lineHeight: 1.45 }}>{children}</div>;
}

export function Vacio({ icono, children }) {
  return (
    <div className="tarjeta" style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--texto-3)', fontSize: 14 }}>
      <img src="/favicon.svg?v=1" alt="" width={56} height={56} style={{ opacity: 0.9 }} />
      <div style={{ marginTop: 10 }}>{children}</div>
    </div>
  );
}

// Tarjeta con lo que la app detectó de la imagen y por qué propone esos ajustes.
export function Sugerencia({ analisis, lineas, onAplicar, etiqueta = 'Usar ajustes sugeridos' }) {
  return (
    <div data-guide="sugerencia" style={{ background: '#F3EAF8', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--morado)' }}>
        <Icon name="sparkles" size={16} />{analisis ? 'Sugerencia para tu imagen' : 'Analizando tu imagen…'}
      </div>
      {analisis && (
        <>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.5, color: 'var(--texto-2)' }}>
            {lineas.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
          {onAplicar && <button type="button" className="btn btn-contorno btn-sm" style={{ alignSelf: 'flex-start' }} onClick={onAplicar}>{etiqueta}</button>}
        </>
      )}
    </div>
  );
}

export function nombreBase(nombre) {
  return String(nombre || 'imagen').replace(/\.[^.]+$/, '');
}

export function megapixeles(w, h) {
  return ((w * h) / 1e6).toFixed(1);
}

export { Icon };
