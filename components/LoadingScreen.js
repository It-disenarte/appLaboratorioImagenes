import Icon from './Icon';

// Capa de carga para operaciones con el servidor. Bloquea clics desde el primer instante
// (evita el doble envío) y se ve con un pequeño retraso para no parpadear en lo rápido.
export function LoadingOverlay({ message }) {
  return (
    <div role="status" aria-live="polite" style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="aparecer-carga" style={{ position: 'absolute', inset: 0, background: 'rgba(250,250,251,.7)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)' }} />
      <div className="aparecer-carga" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: '1px solid var(--borde)', borderRadius: 14, padding: '16px 20px', fontSize: 14, fontWeight: 500, boxShadow: '0 12px 40px rgba(29,27,34,.14)' }}>
        <Icon name="loader" size={20} className="girar" style={{ color: 'var(--morado)' }} />
        {message || 'Cargando…'}
      </div>
    </div>
  );
}

// Pantalla de arranque: ícono de la app y, debajo, la tarjeta con el spinner.
export default function LoadingScreen({ label }) {
  return (
    <div role="status" aria-live="polite" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 16 }}>
      <img src="/favicon.svg" alt="Laboratorio de imágenes" width={64} height={64} />
      <div className="aparecer-carga" style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: '1px solid var(--borde)', borderRadius: 14, padding: '16px 20px', fontSize: 14, fontWeight: 500, boxShadow: '0 12px 40px rgba(29,27,34,.10)' }}>
        <Icon name="loader" size={20} className="girar" style={{ color: 'var(--morado)' }} />
        {label || 'Cargando…'}
      </div>
    </div>
  );
}
