import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import Icon from './Icon';

const C = { primary: '#7C07A6', teal: '#5CC6D0', text: '#1D1B22', body: '#4B4853', muted: '#96989A', border: '#E4E1E8' };
const CARD_MAX_W = 360;
const PAD = 6;
const GAP = 12;

function findTarget(target) {
  return target ? document.querySelector(`[data-guide="${target}"]`) : null;
}

// Asistente de uso: recorre `steps` resaltando cada elemento marcado con data-guide.
// Un paso sin target (o cuyo elemento no se ve) se muestra centrado.
// step: { target?, menu?, title, body?, list?: [[etiqueta, texto]], note? }
// sideMenu: true cuando el menú lateral está fijo (escritorio); sus pasos ponen la tarjeta a su derecha.
export default function GuideTour({ steps, onClose, onDisable, onMenu, sideMenu }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const [vp, setVp] = useState({ w: 1024, h: 768 });
  const [dontShow, setDontShow] = useState(false);
  const [cardH, setCardH] = useState(0);
  const cardRef = useRef(null);
  const step = steps[i];
  const last = i === steps.length - 1;

  const measure = useCallback(() => {
    setVp({ w: window.innerWidth, h: window.innerHeight });
    const el = findTarget(step.target);
    const r = el && el.getBoundingClientRect();
    setRect(r && r.width > 0 && r.height > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null);
  }, [step]);

  // En cada paso: abre/cierra el menú lateral si hace falta, lleva el elemento a la vista y lo mide.
  useEffect(() => {
    if (onMenu) onMenu(!!step.menu);
    const t = setTimeout(() => {
      const el = findTarget(step.target);
      if (el && !step.menu) {
        const r = el.getBoundingClientRect();
        if (r.top < 72 || r.bottom > window.innerHeight - 24) el.scrollIntoView({ block: 'center' });
      }
      measure();
    }, step.menu ? 260 : 40);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { clearTimeout(t); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [step, measure, onMenu]);

  // Alto real de la tarjeta, para que los pasos del menú no se salgan por abajo.
  useLayoutEffect(() => {
    if (cardRef.current && cardRef.current.offsetHeight !== cardH) setCardH(cardRef.current.offsetHeight);
  });

  const finish = useCallback(() => {
    if (onMenu) onMenu(false);
    if (dontShow) onDisable();
    onClose();
  }, [dontShow, onDisable, onClose, onMenu]);

  const next = useCallback(() => { if (last) finish(); else setI((n) => n + 1); }, [last, finish]);
  const prev = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish, next, prev]);

  // Posición de la tarjeta: debajo del elemento si cabe, si no arriba, si no pegada abajo.
  // En escritorio, los pasos del menú lateral la ponen a la derecha del menú.
  const W = Math.min(CARD_MAX_W, vp.w - 32);
  let cardPos;
  if (!rect) {
    cardPos = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  } else if (step.menu && sideMenu && vp.w - (rect.left + rect.width + PAD + GAP) >= W + 16) {
    cardPos = { top: Math.max(16, Math.min(rect.top - PAD, vp.h - cardH - 16)), left: rect.left + rect.width + PAD + GAP };
  } else {
    const left = Math.max(16, Math.min(rect.left + rect.width / 2 - W / 2, vp.w - W - 16));
    const spaceBelow = vp.h - (rect.top + rect.height + PAD + GAP);
    const spaceAbove = rect.top - PAD - GAP;
    if (spaceBelow >= 260 || (spaceBelow >= spaceAbove && spaceBelow >= 180)) cardPos = { top: rect.top + rect.height + PAD + GAP, left };
    else if (spaceAbove >= 180) cardPos = { bottom: vp.h - (rect.top - PAD - GAP), left };
    else cardPos = { bottom: 16, left };
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="guide-title" style={{ position: 'fixed', inset: 0, zIndex: 70 }}>
      {rect ? (
        <div style={{ position: 'fixed', top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2, borderRadius: 12, boxShadow: `0 0 0 2px ${C.teal}, 0 0 0 9999px rgba(29,27,34,0.55)`, transition: 'all .2s ease-out', pointerEvents: 'none' }} />
      ) : (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(29,27,34,0.55)' }} />
      )}

      <div ref={cardRef} style={{ position: 'fixed', ...cardPos, width: W, maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', background: '#fff', borderRadius: 14, boxShadow: '0 12px 40px rgba(0,0,0,0.22)', animation: 'guidePop .18s ease-out' }} key={i}>
        <div style={{ height: 4, background: 'var(--filete)' }} />
        <div style={{ padding: '16px 18px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: C.primary }}>Asistente · {i + 1} de {steps.length}</span>
            <button onClick={finish} aria-label="Cerrar asistente" style={{ border: 'none', background: 'none', padding: 2, cursor: 'pointer', color: C.muted, display: 'flex' }}>
              <Icon name="x" size={18} />
            </button>
          </div>
          <div id="guide-title" style={{ fontSize: 17, fontWeight: 600, color: C.text, marginBottom: 6 }}>{step.title}</div>
          {step.body && <div style={{ fontSize: 14, lineHeight: 1.5, color: C.body }}>{step.body}</div>}
          {step.list && (
            <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {step.list.map(([label, text]) => (
                <li key={label} style={{ fontSize: 13, lineHeight: 1.45, color: C.body, paddingLeft: 12, borderLeft: `2px solid ${C.border}` }}>
                  <b style={{ color: C.text, fontWeight: 600 }}>{label}:</b> {text}
                </li>
              ))}
            </ul>
          )}
          {step.note && <div style={{ fontSize: 12, lineHeight: 1.45, color: C.body, background: '#F3EAF8', borderRadius: 8, padding: '8px 10px', marginTop: 10 }}>{step.note}</div>}

          <div style={{ display: 'flex', gap: 4, marginTop: 14 }}>
            {steps.map((_, n) => (
              <span key={n} style={{ height: 3, flex: 1, borderRadius: 2, background: n <= i ? C.primary : C.border, transition: 'background .2s' }} />
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 14 }}>
            {last ? <span /> : <button onClick={finish} style={{ border: 'none', background: 'none', color: C.muted, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '8px 0' }}>Saltar</button>}
            <div style={{ display: 'flex', gap: 8 }}>
              {i > 0 && <button onClick={prev} className="btn btn-contorno btn-sm">Anterior</button>}
              <button onClick={next} autoFocus className="btn btn-primario btn-sm">{last ? 'Entendido' : 'Siguiente'}</button>
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}`, fontSize: 12, color: C.body, cursor: 'pointer' }}>
            <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} style={{ marginTop: 2, accentColor: C.primary }} />
            <span>No volver a mostrar el asistente. <span style={{ color: C.muted }}>Puedes reactivarlo desde el menú.</span></span>
          </label>
        </div>
      </div>
      <style>{`@keyframes guidePop { from { opacity: 0; transform: ${rect ? 'translateY(6px)' : 'translate(-50%, -46%)'}; } }`}</style>
    </div>
  );
}
