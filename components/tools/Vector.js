import { useEffect, useMemo, useState } from 'react';
import Visor from '../Visor';
import { Deslizador, Segmentos, Casilla, Panel, Seccion, Aviso, Sugerencia, nombreBase, Icon } from '../ui';
import { descargar } from '../../lib/imaging/client';
import { svgAPdf } from '../../lib/imaging/pdf';

const MODOS = [
  ['logo', 'Logo'],
  ['bn', 'Una tinta'],
  ['foto', 'Foto'],
];

export default function Vector({ doc, analisis, ejecutar }) {
  const img = doc.img;
  const [modo, setModo] = useState('logo');
  const [colores, setColores] = useState(8);
  const [detalle, setDetalle] = useState(60);
  const [suavizar, setSuavizar] = useState(30);
  const [umbral, setUmbral] = useState(128);
  const [sinFondo, setSinFondo] = useState(true);
  const [res, setRes] = useState(null);
  const [ver, setVer] = useState('vector');
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState('');

  useEffect(() => { setRes(null); setError(''); }, [img]);
  const sug = analisis ? analisis.sugerencia.vector : null;
  function usarSugerencia() {
    if (!sug) return;
    setModo(sug.modo); setColores(sug.colores); setDetalle(sug.detalle); setSuavizar(sug.suavizar); setUmbral(sug.umbral);
  }
  useEffect(() => { usarSugerencia(); }, [analisis]); // eslint-disable-line react-hooks/exhaustive-deps
  // Al cambiar de tipo a mano se propone un número de colores razonable para ese tipo.
  function elegirModo(m) { setModo(m); setColores(m === 'foto' ? 24 : sug && sug.modo === m ? sug.colores : 8); }

  const urlSvg = useMemo(() => (res ? URL.createObjectURL(new Blob([res.svg], { type: 'image/svg+xml' })) : null), [res]);
  useEffect(() => () => { if (urlSvg) URL.revokeObjectURL(urlSvg); }, [urlSvg]);

  async function vectorizar() {
    setError('');
    try {
      const r = await ejecutar('vector', { img, opts: { modo, colores, detalle, suavizar, umbral, sinFondo } }, 'Vectorizando…');
      setRes(r); setVer('vector'); setZoom(1);
    } catch (e) { setError(e.message); }
  }

  const bajarSvg = () => descargar(new Blob([res.svg], { type: 'image/svg+xml' }), `${nombreBase(doc.nombre)}.svg`);
  const bajarPdf = () => descargar(new Blob([svgAPdf(res.svg, res.ancho, res.alto)], { type: 'application/pdf' }), `${nombreBase(doc.nombre)}.pdf`);

  return (
    <div className="herramienta">
      <div data-guide="visor">
        {!res || ver === 'original' ? (
          <Visor img={img}>
            {res && <Segmentos etiqueta="Qué ver" value={ver} onChange={setVer} opciones={[['original', 'Original'], ['vector', 'Vector']]} />}
          </Visor>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              <button className="btn btn-contorno btn-sm" style={{ width: 34, padding: 0 }} onClick={() => setZoom((z) => Math.max(0.1, z / 1.25))} aria-label="Alejar"><Icon name="minus" size={16} /></button>
              <button className="btn btn-contorno btn-sm" style={{ minWidth: 64 }} onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
              <button className="btn btn-contorno btn-sm" style={{ width: 34, padding: 0 }} onClick={() => setZoom((z) => Math.min(16, z * 1.25))} aria-label="Acercar"><Icon name="plus" size={16} /></button>
              <span style={{ flex: 1 }} />
              <div data-guide="comparar"><Segmentos etiqueta="Qué ver" value={ver} onChange={setVer} opciones={[['original', 'Original'], ['vector', 'Vector']]} /></div>
            </div>
            <div className="damero" style={{ border: '1px solid var(--borde)', borderRadius: 12, overflow: 'auto', height: '62vh', minHeight: 240, display: 'flex' }}>
              <img src={urlSvg} alt="Vista previa del vector" style={{ width: `${zoom * 100}%`, maxWidth: zoom <= 1 ? '100%' : 'none', maxHeight: zoom <= 1 ? '100%' : 'none', objectFit: 'contain', margin: 'auto', flex: 'none' }} />
            </div>
          </div>
        )}
        {res && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <span className="chip-info">{res.rutas} formas</span>
            <span className="chip-info">{res.colores.length} colores</span>
            <span className="chip-info">SVG de {(res.svg.length / 1024).toFixed(0)} KB</span>
            <span style={{ display: 'inline-flex', gap: 3 }} aria-label="Colores usados">
              {res.colores.slice(0, 16).map((c) => <span key={c} title={c} style={{ width: 18, height: 18, borderRadius: 4, background: c, border: '1px solid var(--borde-campo)' }} />)}
            </span>
          </div>
        )}
      </div>

      <Panel data-guide="panel">
        <Sugerencia analisis={analisis} onAplicar={usarSugerencia} lineas={sug ? [analisis.sugerencia.resumen[0], sug.porQue] : []} />
        <Seccion titulo="Tipo de imagen">
          <div data-guide="modo" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Segmentos etiqueta="Tipo de vectorizado" value={modo} onChange={elegirModo} opciones={MODOS} />
          </div>
          <span className="ayuda">
            {modo === 'logo' && 'Logo / colores planos: para logotipos, íconos, ilustraciones y rotulación con pocos colores sólidos.'}
            {modo === 'bn' && 'Una tinta (blanco y negro): ideal para sellos, plantillas, corte en vinil o láser.'}
            {modo === 'foto' && 'Para fotos: genera un efecto de ilustración por capas. Úsalo con muchos colores y el archivo será pesado.'}
          </span>
        </Seccion>

        <Seccion titulo="Ajustes">
          {modo !== 'bn' && <div data-guide="colores"><Deslizador label="Número de colores" value={colores} min={2} max={modo === 'foto' ? 64 : 32} onChange={setColores} ayuda="Cuenta también el color del fondo. Si el resultado junta colores distintos, súbelo." /></div>}
          {modo === 'bn' && <Deslizador label="Umbral negro / blanco" value={umbral} min={20} max={235} onChange={setUmbral} ayuda="Más alto = más negro. Ajústalo hasta que los trazos finos se vean completos." />}
          <Deslizador label="Detalle" value={detalle} onChange={setDetalle} ayuda="Más detalle conserva manchas pequeñas; menos las elimina y da un archivo más limpio." />
          <Deslizador label="Suavizar bordes" value={suavizar} onChange={setSuavizar} ayuda="Redondea el dentado de imágenes de baja resolución." />
          <Casilla checked={sinFondo} onChange={setSinFondo} ayuda={modo === 'foto' ? 'Elimina la forma del fondo para que no tengas que borrarla en Illustrator o Corel. En fotos solo se aplica si la imagen ya tiene el fondo transparente.' : 'Elimina la forma del fondo para que no tengas que borrarla en Illustrator o Corel.'}>Quitar el fondo del vector</Casilla>
        </Seccion>

        {error && <Aviso tipo="error">{error}</Aviso>}

        <Seccion>
          <button data-guide="accion" className="btn btn-primario" style={{ minHeight: 42 }} onClick={vectorizar}><Icon name="vector" size={17} />{res ? 'Vectorizar de nuevo' : 'Vectorizar'}</button>
          {res && (
            <div data-guide="resultado" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn btn-contorno" onClick={bajarSvg}><Icon name="download" size={16} />Descargar SVG</button>
              <button className="btn btn-contorno" onClick={bajarPdf}><Icon name="download" size={16} />Descargar PDF vectorial</button>
              <span className="ayuda">El SVG y el PDF abren como vectores editables en Illustrator, CorelDRAW, Inkscape y Affinity. Cada color queda en su propia capa de formas.</span>
            </div>
          )}
        </Seccion>
      </Panel>
    </div>
  );
}
