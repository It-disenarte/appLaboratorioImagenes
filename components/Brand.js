// Bloque de marca: ícono de la app + "Laboratorio de imágenes" + "DISEÑARTE MÉXICO".
// onDark: texto blanco (sobre el morado); si no, nombre en morado y subtítulo gris.
export default function Brand({ size = 44, onDark, style }) {
  const big = size >= 64;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, ...style }}>
      <img src="/favicon.svg?v=1" alt="" width={size} height={size} style={{ flexShrink: 0 }} />
      <div style={{ lineHeight: 1.2, minWidth: 0 }}>
        <div style={{ fontSize: big ? 22 : 16, fontWeight: 600, color: onDark ? '#fff' : 'var(--morado)' }}>Laboratorio de imágenes</div>
        <div style={{ fontSize: big ? 11 : 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.25em', color: onDark ? 'rgba(255,255,255,.75)' : 'var(--texto-3)', whiteSpace: 'nowrap' }}>Diseñarte México</div>
      </div>
    </div>
  );
}
