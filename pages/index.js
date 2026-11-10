import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon';
import LoadingScreen, { LoadingOverlay } from '../components/LoadingScreen';
import SideMenu, { SIDE_MENU_WIDTH } from '../components/SideMenu';
import GuideTour from '../components/GuideTour';
import { megapixeles } from '../components/ui';
import Calidad from '../components/tools/Calidad';
import Fondo from '../components/tools/Fondo';
import Objetos from '../components/tools/Objetos';
import Vector from '../components/tools/Vector';
import { ejecutar as ejecutarOp, cargarArchivo, recortePrecision, quitarObjetosPrecision, mejorarConDetalle } from '../lib/imaging/client';
import { generalSteps, sectionSteps } from '../lib/guideSteps';

const WIDE_QUERY = '(min-width: 768px)';
const MAX_PIXELES = 50e6;
const CLAVE_GUIA = 'lab-asistente'; // preferencia del asistente de uso, guardada en este navegador

const TOOLS = [
  { key: 'calidad', label: 'Mejorar calidad', icon: 'zoom', title: 'Mejorar calidad', desc: 'Agranda la imagen y recupera nitidez.' },
  { key: 'fondo', label: 'Quitar fondo', icon: 'scissors', title: 'Quitar fondo', desc: 'Deja el objeto sobre fondo transparente.' },
  { key: 'objetos', label: 'Quitar objetos', icon: 'eraser', title: 'Quitar objetos', desc: 'Borra lo que marques y rellena con el entorno.' },
  { key: 'vector', label: 'Vectorizar', icon: 'vector', title: 'Vectorizar', desc: 'Convierte la imagen en SVG o PDF editable.' },
];

const meta = { fontSize: 13, color: 'var(--texto-3)' };

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [showGuide, setShowGuide] = useState(true);
  const [section, setSection] = useState('calidad');
  const [doc, setDoc] = useState(null); // { img, nombre }
  const [hist, setHist] = useState([]); // imágenes anteriores (deshacer)
  const [busy, setBusy] = useState(null); // { msg, p }
  const [error, setError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [isWide, setIsWide] = useState(false);
  const [installEvent, setInstallEvent] = useState(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [analisis, setAnalisis] = useState(null); // { metricas, sugerencia } de la imagen de trabajo
  const inputArchivo = useRef(null);

  // Pantalla de carga inicial breve; aquí también se lee la preferencia del asistente.
  useEffect(() => {
    try { if (localStorage.getItem(CLAVE_GUIA) === '0') setShowGuide(false); } catch { /* sin almacenamiento */ }
    const t = setTimeout(() => setLoading(false), 500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const update = () => setIsWide(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    function onPrompt(e) { e.preventDefault(); setInstallEvent(e); }
    function onInstalled() { setInstallEvent(null); }
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);
  async function installApp() {
    if (!installEvent) return;
    setMenuOpen(false);
    installEvent.prompt();
    await installEvent.userChoice.catch(() => {});
    setInstallEvent(null);
  }

  // ---------- Imagen de trabajo ----------
  async function abrirArchivo(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { setError('Ese archivo no es una imagen. Usa PNG, JPG, WEBP, GIF o BMP.'); return; }
    setError('');
    setBusy({ msg: 'Abriendo la imagen…' });
    try {
      const img = await cargarArchivo(file);
      if (img.width * img.height > MAX_PIXELES) throw new Error(`La imagen es muy grande (${megapixeles(img.width, img.height)} MP). El máximo es de ${MAX_PIXELES / 1e6} megapíxeles.`);
      setDoc({ img, nombre: file.name || 'imagen.png' });
      setHist([]);
    } catch (e) { setError(e.message); }
    setBusy(null);
  }

  // Pegar una imagen con Ctrl + V
  useEffect(() => {
    function onPaste(e) {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (item) { e.preventDefault(); abrirArchivo(item.getAsFile()); }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  // Refs con el estado más reciente: evitan efectos secundarios dentro de los "updaters" de React.
  const docRef = useRef(null);
  const histRef = useRef([]);
  docRef.current = doc;
  histRef.current = hist;
  const aplicar = useCallback((img) => {
    const actual = docRef.current;
    if (!actual) return;
    setHist([...histRef.current.slice(-7), actual.img]);
    setDoc({ ...actual, img: { data: img.data, width: img.width, height: img.height } });
  }, []);
  const deshacer = useCallback(() => {
    const h = histRef.current;
    if (!h.length) return;
    setDoc({ ...docRef.current, img: h[h.length - 1] });
    setHist(h.slice(0, -1));
  }, []);

  // Analiza la imagen de trabajo cada vez que cambia, para sugerir ajustes en cada herramienta.
  const imgActual = doc ? doc.img : null;
  useEffect(() => {
    setAnalisis(null);
    if (!imgActual) return;
    let vigente = true;
    // Pantalla de carga que bloquea la app hasta terminar el análisis (la marca `analisis` evita
    // cerrar por error la de otra operación).
    setBusy({ msg: 'Analizando tu imagen…', p: null, analisis: true });
    const terminar = () => setBusy((b) => (b && b.analisis ? null : b));
    ejecutarOp('analizar', { img: imgActual })
      .then((r) => { if (vigente) setAnalisis(r); })
      .catch(() => {})
      .finally(() => { if (vigente) terminar(); });
    return () => { vigente = false; terminar(); };
  }, [imgActual]);

  // Corre una operación pesada en el Web Worker, con pantalla de carga y avance.
  const ejecutar = useCallback(async (op, args, mensaje) => {
    setBusy({ msg: mensaje, p: 0 });
    try {
      const avance = (msg, p) => setBusy({ msg: msg || mensaje, p });
      if (op === 'precision') return await recortePrecision(args.img, args.opts, avance);
      if (op === 'detalle') return await mejorarConDetalle(args.img, args.opts, avance);
      if (op === 'objetosPrecision') return await quitarObjetosPrecision(args.img, args.mask, args.opts, avance);
      return await ejecutarOp(op, args, avance);
    } finally { setBusy(null); }
  }, []);

  // ---------- Asistente de uso ----------
  const [guideSteps, setGuideSteps] = useState(null);
  const seenGuides = useRef(new Set());
  const closeGuide = useCallback(() => setGuideSteps(null), []);
  const menuOpenRef = useRef(false);
  const guideOpenedMenu = useRef(false);
  useEffect(() => { menuOpenRef.current = menuOpen; }, [menuOpen]);
  const setMenuFromGuide = useCallback((open) => {
    if (open && !menuOpenRef.current) { guideOpenedMenu.current = true; setMenuOpen(true); }
    else if (!open && guideOpenedMenu.current) { guideOpenedMenu.current = false; setMenuOpen(false); }
  }, []);

  function openGuide(sec, withGeneral) {
    const ctx = { isWide, hasImage: !!doc };
    const steps = [...(withGeneral ? generalSteps(ctx) : []), ...sectionSteps(sec, ctx)]
      .filter((s) => !s.target || document.querySelector(`[data-guide="${s.target}"]`))
      .filter((s) => !s.list || s.list.length > 0 || s.body);
    seenGuides.current.add(sec);
    if (withGeneral) seenGuides.current.add('general');
    if (steps.length) setGuideSteps(steps);
  }
  function setGuidePreference(mostrar) {
    setShowGuide(mostrar);
    try { localStorage.setItem(CLAVE_GUIA, mostrar ? '1' : '0'); } catch { /* sin almacenamiento */ }
    if (mostrar) seenGuides.current.clear();
  }

  useEffect(() => {
    if (loading || !showGuide || guideSteps || busy) return;
    if (seenGuides.current.has(section)) return;
    const withGeneral = !seenGuides.current.has('general');
    const t = setTimeout(() => openGuide(section, withGeneral), 500);
    return () => clearTimeout(t);
  });
  // Al cargar la imagen cambian los elementos de la pantalla: la guía de esa herramienta se vuelve a ofrecer.
  const hayImagen = !!doc;
  useEffect(() => { ['calidad', 'fondo', 'objetos', 'vector'].forEach((s) => seenGuides.current.delete(s)); }, [hayImagen]);

  function selectSection(key) { setSection(key); setMenuOpen(false); setError(''); }
  function helpFromMenu() { setMenuOpen(false); openGuide(section, false); }
  function toggleGuideFromMenu() { if (!isWide) setMenuOpen(false); setGuidePreference(!showGuide); }
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // ---------- Render ----------
  if (loading) return <LoadingScreen label="Cargando…" />;

  const herramienta = TOOLS.find((t) => t.key === section);
  const props = { doc, analisis, ejecutar, aplicar, deshacer, puedeDeshacer: hist.length > 0 };

  return (
    <div style={{ minHeight: '100vh' }}>
      {guideSteps && <GuideTour steps={guideSteps} onClose={closeGuide} onDisable={() => setGuidePreference(false)} onMenu={setMenuFromGuide} sideMenu={isWide} />}
      {busy && <LoadingOverlay message={busy.p != null && busy.p > 0 && busy.p < 1 ? `${busy.msg} ${Math.round(busy.p * 100)} %` : busy.msg} />}
      <SideMenu
        open={menuOpen} persistent={isWide} onClose={closeMenu}
        tools={TOOLS} section={section} onSelectSection={selectSection}
        showGuide={showGuide} onToggleGuide={toggleGuideFromMenu} onHelp={helpFromMenu}
        onInstall={installEvent ? installApp : null}
      />

      <div style={{ paddingLeft: isWide ? SIDE_MENU_WIDTH : 0 }}>
        {!isWide && (
          <header style={{ position: 'sticky', top: 0, zIndex: 30, background: 'var(--morado)', color: '#fff', paddingTop: 'env(safe-area-inset-top)' }}>
            <div style={{ height: 56, display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px' }}>
              <button data-guide="menu-button" className="menu-icono" onClick={() => setMenuOpen(true)} aria-label="Abrir menú"><Icon name="menu" size={24} /></button>
              <img src="/favicon.svg?v=1" alt="" width={30} height={30} />
              <span style={{ flex: 1, fontSize: 17, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Laboratorio de imágenes</span>
              <button data-guide="help-button" className="menu-icono" onClick={() => openGuide(section, false)} aria-label="Ver guía de esta pantalla" title="Ver guía de esta pantalla"><Icon name="help" size={22} /></button>
            </div>
            <div style={{ height: 3, background: 'var(--filete)' }} />
          </header>
        )}

        <main style={{ maxWidth: 1240, margin: '0 auto', padding: isWide ? '32px 24px 48px' : '20px 16px 40px' }}>
          <div data-guide="header-title" style={{ marginBottom: 18 }}>
            <h1 style={{ margin: 0, fontSize: isWide ? 28 : 24, fontWeight: 600, color: 'var(--morado)' }}>{herramienta.title}</h1>
            <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--texto-3)' }}>{herramienta.desc}</p>
          </div>

          {error && <div role="alert" style={{ background: 'var(--error-fondo)', color: 'var(--error)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 14 }}>{error}</div>}

          {!doc && (
            <div
              data-guide="subir" className={`zona-subida${arrastrando ? ' arriba' : ''}`} role="button" tabIndex={0}
              onClick={() => inputArchivo.current && inputArchivo.current.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputArchivo.current.click(); } }}
              onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
              onDragLeave={() => setArrastrando(false)}
              onDrop={(e) => { e.preventDefault(); setArrastrando(false); abrirArchivo(e.dataTransfer.files[0]); }}
            >
              <img src="/favicon.svg?v=1" alt="" width={64} height={64} />
              <div style={{ marginTop: 12, fontSize: 17, fontWeight: 600, color: 'var(--morado)' }}>Arrastra una imagen aquí</div>
              <div style={{ marginTop: 4, ...meta }}>o toca para elegirla de tu equipo · también puedes pegarla con Ctrl + V</div>
              <div style={{ marginTop: 10, ...meta, fontSize: 12 }}>PNG, JPG, WEBP, GIF o BMP · hasta {MAX_PIXELES / 1e6} megapíxeles · se procesa en tu equipo, no se sube a ningún servidor</div>
            </div>
          )}
          <input ref={inputArchivo} type="file" accept="image/*" hidden onChange={(e) => { abrirArchivo(e.target.files[0]); e.target.value = ''; }} />

          {doc && (
            <>
              <div data-guide="barra-imagen" className="tarjeta" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                <Icon name="image" size={18} style={{ color: 'var(--morado)' }} />
                <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.nombre}>{doc.nombre}</div>
                  <div style={meta}>{doc.img.width} × {doc.img.height} px · {megapixeles(doc.img.width, doc.img.height)} MP</div>
                </div>
                <button className="btn btn-fantasma btn-sm" onClick={deshacer} disabled={!hist.length}><Icon name="undo" size={15} />Deshacer</button>
                <button className="btn btn-contorno btn-sm" onClick={() => inputArchivo.current.click()}><Icon name="upload" size={15} />Cambiar imagen</button>
              </div>
              {section === 'calidad' && <Calidad {...props} />}
              {section === 'fondo' && <Fondo {...props} />}
              {section === 'objetos' && <Objetos {...props} />}
              {section === 'vector' && <Vector {...props} />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
