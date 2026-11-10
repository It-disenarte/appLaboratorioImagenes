import { useEffect } from 'react';
import Brand from './Brand';
import Icon from './Icon';

export const SIDE_MENU_WIDTH = 256;

function Item({ active, onClick, icon, children, ...rest }) {
  return (
    <button className="menu-item" aria-current={active ? 'page' : undefined} onClick={onClick} {...rest}>
      {icon && <Icon name={icon} size={17} />}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
    </button>
  );
}

function Label({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,.55)', padding: '18px 12px 6px' }}>{children}</div>;
}

// Menú lateral morado: fijo en escritorio (≥ 768 px); en celular sale como cajón desde la izquierda.
export default function SideMenu({ open, persistent, onClose, tools, section, onSelectSection, showGuide, onToggleGuide, onHelp, onInstall }) {
  useEffect(() => {
    if (persistent || !open) return;
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, persistent, onClose]);

  const visible = persistent || open;

  return (
    <>
      {!persistent && (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(29,27,34,.4)', opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none', transition: 'opacity .22s', zIndex: 40 }} />
      )}
      <nav aria-label="Menú principal" aria-hidden={!visible} style={{ position: 'fixed', top: 0, bottom: 0, left: 0, width: SIDE_MENU_WIDTH, maxWidth: '85vw', background: 'var(--morado)', color: '#fff', display: 'flex', flexDirection: 'column', transform: visible ? 'none' : 'translateX(-100%)', visibility: visible ? 'visible' : 'hidden', transition: 'transform .22s ease-out, visibility .22s', boxShadow: !persistent && open ? '4px 0 24px rgba(0,0,0,.2)' : 'none', zIndex: 45 }}>
        <div style={{ position: 'relative', padding: 'calc(28px + env(safe-area-inset-top)) 24px 20px', flexShrink: 0 }}>
          <Brand size={44} onDark />
          {!persistent && (
            <button className="menu-icono" onClick={onClose} aria-label="Cerrar menú" style={{ position: 'absolute', top: 'calc(10px + env(safe-area-inset-top))', right: 10 }}>
              <Icon name="x" size={20} />
            </button>
          )}
        </div>
        <div style={{ height: 2, margin: '0 24px', borderRadius: 1, background: 'var(--filete)', flexShrink: 0 }} />

        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 12px 12px' }}>
          <div data-guide="menu-tools">
            <Label>Herramientas</Label>
            {tools.map((v) => (
              <Item key={v.key} icon={v.icon} active={section === v.key} onClick={() => onSelectSection(v.key)}>{v.label}</Item>
            ))}
          </div>

          <div data-guide="menu-account">
            <Label>Ayuda</Label>
            <button className="menu-item" role="switch" aria-checked={!!showGuide} onClick={onToggleGuide}>
              <Icon name="sparkles" size={17} />
              <span style={{ flex: 1 }}>Asistente de uso</span>
              <span style={{ width: 34, height: 20, borderRadius: 10, background: showGuide ? 'var(--turquesa)' : 'rgba(255,255,255,.25)', position: 'relative', flexShrink: 0, transition: 'background .2s' }}>
                <span style={{ position: 'absolute', top: 2, left: showGuide ? 16 : 2, width: 16, height: 16, borderRadius: 8, background: '#fff', transition: 'left .2s' }} />
              </span>
            </button>
            <Item icon="help" onClick={onHelp} data-guide="menu-help">Ver guía de esta pantalla</Item>
            {onInstall && <Item icon="download" onClick={onInstall}>Instalar como app</Item>}
          </div>
        </div>

        <div data-guide="menu-footer" style={{ borderTop: '1px solid rgba(255,255,255,.15)', padding: '14px 20px calc(14px + env(safe-area-inset-bottom))', fontSize: 12, lineHeight: 1.45, color: 'rgba(255,255,255,.7)', flexShrink: 0 }}>
          Tus imágenes se procesan en tu equipo y no se guardan en ningún lado.
        </div>
      </nav>
    </>
  );
}
