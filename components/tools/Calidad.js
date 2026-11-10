import { useEffect, useState } from 'react';
import Visor from '../Visor';
import { Deslizador, Segmentos, Panel, Seccion, Aviso, Sugerencia, nombreBase, megapixeles, Icon } from '../ui';
import { aBlob, descargar } from '../../lib/imaging/client';

const MAX_SALIDA = 36e6; // píxeles
// Píxeles de entrada máximos para reconstruir detalle (el modelo trabaja a 4×). Con tarjeta gráfica compatible
// tarda segundos; sin ella corre en el procesador (~6 min por megapíxel), así que el tope es menor.
const MAX_DETALLE_GPU = 1.5e6;
const MAX_DETALLE_CPU = 0.4e6;

const PRESETS = [
  ['grafico', 'Gráfico', { nitidez: 35, limpiar: 10 }],
  ['foto', 'Foto', { nitidez: 50, limpiar: 30 }],
  ['jpg', 'JPG pesado', { nitidez: 40, limpiar: 75 }],
];

export default function Calidad({ doc, analisis, ejecutar, aplicar }) {
  const img = doc.img;
  const [factor, setFactor] = useState(2);
  const [nitidez, setNitidez] = useState(50);
  const [limpiar, setLimpiar] = useState(30);
  const [preset, setPreset] = useState('foto');
  const [hayGpu, setHayGpu] = useState(true);
  useEffect(() => { setHayGpu(typeof navigator !== 'undefined' && !!navigator.gpu); }, []);
  const maxDetalle = hayGpu ? MAX_DETALLE_GPU : MAX_DETALLE_CPU;
  const permiteDetalle = img.width * img.height <= maxDetalle;
  const [metodo, setMetodo] = useState('detalle'); // detalle | rapido
  const usaDetalle = metodo === 'detalle' && permiteDetalle;
  const [res, setRes] = useState(null);
  const [ver, setVer] = useState('resultado');
  const [error, setError] = useState('');

  // Un resultado pertenece a la imagen con la que se calculó.
  useEffect(() => { setRes(null); setVer('resultado'); setError(''); }, [img]);

  const cabe = (f) => img.width * f * (img.height * f) <= MAX_SALIDA;
  useEffect(() => { if (!cabe(factor)) setFactor([4, 3, 2, 1].find(cabe) || 1); }, [img]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al terminar el análisis se aplican los ajustes sugeridos (el usuario puede cambiarlos).
  const sug = analisis ? analisis.sugerencia.calidad : null;
  function usarSugerencia() {
    if (!sug) return;
    const f = [sug.factor, 3, 2, 1].find((x) => x <= sug.factor && cabe(x)) || 1;
    setFactor(f); setNitidez(sug.nitidez); setLimpiar(sug.limpiar); setPreset(sug.preset);
    setMetodo(permiteDetalle ? 'detalle' : 'rapido');
  }
  useEffect(() => { usarSugerencia(); }, [analisis]); // eslint-disable-line react-hooks/exhaustive-deps

  function elegirPreset(k) {
    const p = PRESETS.find((x) => x[0] === k);
    setPreset(k); setNitidez(p[2].nitidez); setLimpiar(p[2].limpiar);
  }

  async function mejorar() {
    setError('');
    try {
      const r = usaDetalle
        ? await ejecutar('detalle', { img, opts: { factor } }, 'Reconstruyendo detalle…')
        : await ejecutar('calidad', { img, opts: { factor, nitidez, limpiar } }, 'Mejorando la imagen…');
      setRes(r); setVer('resultado');
    } catch (e) { setError(e.message); }
  }

  async function bajar(tipo) {
    const ext = tipo === 'image/png' ? 'png' : 'jpg';
    const blob = await aBlob(res, tipo, 0.95);
    descargar(blob, `${nombreBase(doc.nombre)}-mejorada-${factor}x.${ext}`);
  }

  const mostrado = res && ver === 'resultado' ? res : img;
  const base = res ? { w: res.width, h: res.height } : undefined;

  return (
    <div className="herramienta">
      <div data-guide="visor">
        <Visor img={mostrado} base={base}>
          {res && (
            <div data-guide="comparar">
              <Segmentos etiqueta="Qué imagen ver" value={ver} onChange={setVer} opciones={[['original', 'Original'], ['resultado', 'Mejorada']]} />
            </div>
          )}
        </Visor>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <span className="chip-info">Original: {img.width} × {img.height} px</span>
          {res && <span className="chip-info">Mejorada: {res.width} × {res.height} px ({megapixeles(res.width, res.height)} MP)</span>}
        </div>
      </div>

      <Panel data-guide="panel">
        <Sugerencia analisis={analisis} onAplicar={usarSugerencia} lineas={sug ? [analisis.sugerencia.resumen[0], ...sug.porQue.map((t) => t.charAt(0).toUpperCase() + t.slice(1) + '.')] : []} />
        <Seccion titulo="Método">
          <div data-guide="metodo">
            <Segmentos etiqueta="Método" value={usaDetalle ? 'detalle' : 'rapido'} onChange={setMetodo} opciones={[['detalle', 'Reconstruir detalle', !permiteDetalle], ['rapido', 'Rápido']]} />
          </div>
          <span className="ayuda">
            {usaDetalle
              ? 'Rehace el detalle que faltaba (bordes, texturas, texto pequeño) en vez de solo estirar los píxeles. Es lo más cercano a tener la imagen en mayor resolución. Tarda de unos segundos a un par de minutos, según el tamaño y el equipo.'
              : 'Estira la imagen con un escalado de alta calidad y la afila. Es inmediato y no inventa detalle.'}
            {!permiteDetalle && ` «Reconstruir detalle» está disponible para imágenes de hasta ${maxDetalle / 1e6} megapíxeles${hayGpu ? '' : ' en este equipo'}; esta es más grande.`}
          </span>
        </Seccion>

        {!usaDetalle && (
          <Seccion titulo="Tipo de imagen">
            <Segmentos etiqueta="Tipo de imagen" value={preset} onChange={elegirPreset} opciones={PRESETS.map(([k, t]) => [k, t])} />
            <span className="ayuda">Gráfico: logos e ilustraciones. Foto: fotografías. JPG pesado: imágenes con cuadritos por compresión. Es un punto de partida; afínalo después.</span>
          </Seccion>
        )}

        <Seccion titulo="Ajustes">
          <div data-guide="factor" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>Aumentar tamaño</span>
            <Segmentos etiqueta="Aumento" value={factor} onChange={setFactor} opciones={[[1, 'Igual', false], [2, '2×', !cabe(2)], [3, '3×', !cabe(3)], [4, '4×', !cabe(4)]]} />
            <span className="ayuda">Resultado: {Math.round(img.width * factor)} × {Math.round(img.height * factor)} px. El máximo es de {MAX_SALIDA / 1e6} megapíxeles.</span>
          </div>
          {!usaDetalle && <Deslizador label="Nitidez" value={nitidez} onChange={(v) => { setNitidez(v); setPreset(''); }} ayuda="Realza los bordes. Si ves halos o bordes duros, bájala." />}
          {!usaDetalle && <Deslizador label="Limpiar ruido y JPG" value={limpiar} onChange={(v) => { setLimpiar(v); setPreset(''); }} ayuda="Suaviza el grano y los cuadritos de la compresión sin borrar los contornos." />}
          {usaDetalle && factor === 1 && <span className="ayuda">Con «Igual» el tamaño no cambia: el modelo reconstruye el detalle y limpia el ruido y los cuadritos del JPG.</span>}
        </Seccion>

        {error && <Aviso tipo="error">{error}</Aviso>}

        <Seccion>
          <button data-guide="accion" className="btn btn-primario" style={{ minHeight: 42 }} onClick={mejorar}><Icon name="zoom" size={17} />{res ? 'Volver a mejorar' : 'Mejorar imagen'}</button>
          {res && (
            <div data-guide="resultado" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn btn-contorno" onClick={() => { aplicar(res, `Mejora ${factor}×`); }}><Icon name="check" size={16} />Usar como imagen de trabajo</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-contorno" style={{ flex: 1 }} onClick={() => bajar('image/png')}><Icon name="download" size={16} />PNG</button>
                <button className="btn btn-contorno" style={{ flex: 1 }} onClick={() => bajar('image/jpeg')}><Icon name="download" size={16} />JPG</button>
              </div>
              <span className="ayuda">«Usar como imagen de trabajo» deja el resultado listo para quitarle el fondo, eliminar objetos o vectorizarlo.</span>
            </div>
          )}
        </Seccion>
      </Panel>
    </div>
  );
}
