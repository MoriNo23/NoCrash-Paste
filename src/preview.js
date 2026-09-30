/**
 * Preview propio: badge fijo en la esquina + overlay modal con el
 * contenido íntegro del adjunto.
 *
 * Gemini no muestra vista previa de .txt adjuntos — solo un chip
 * estático. Como no podemos inyectar elementos dentro del DOM controlado
 * por Angular sin que los destruya, colocamos un badge flotante en la
 * esquina superior derecha del viewport. Al hacer click se abre un
 * overlay con el texto completo, numerado y scrollable.
 */

const Z = 2147483647;
const BADGE_TTL_MS = 5 * 60 * 1000; // 5 minutos

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Crea el par badge+overlay. `config.preview` actúa como feature flag.
 * Devuelve `show({ text, fileName, metrics })` — admite múltiples llamadas
 * (cada paste reemplaza el badge anterior).
 */
export function createPreview({ config, doc = document } = {}) {
  if (!config?.preview) return () => {};
  const overlay = createPreviewOverlay(doc);
  let badge = null;
  let badgeTimer = null;

  function removeBadge() {
    clearTimeout(badgeTimer);
    badge?.remove();
    badge = null;
  }

  return function show({ text, fileName, metrics }) {
    removeBadge();

    badge = doc.createElement('div');
    badge.className = 'nocrash-preview-badge';
    badge.setAttribute('role', 'button');
    badge.setAttribute('tabindex', '0');
    badge.title = 'Click para ver el contenido completo del adjunto';
    Object.assign(badge.style, {
      position: 'fixed',
      top: '16px',
      right: '16px',
      zIndex: String(Z - 1),
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 16px',
      borderRadius: '22px',
      cursor: 'pointer',
      background: '#7c5cff',
      color: '#fff',
      font: '12px/1.4 system-ui, sans-serif',
      userSelect: 'none',
      whiteSpace: 'nowrap',
      maxWidth: '380px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      boxShadow: '0 4px 16px rgba(124,92,255,.4)',
      transition: 'background .15s ease, opacity .25s ease',
      opacity: '0',
    });

    badge.addEventListener('mouseenter', () => { badge.style.background = '#6940e8'; });
    badge.addEventListener('mouseleave', () => { badge.style.background = '#7c5cff'; });
    badge.addEventListener('click', () => overlay(text, fileName, metrics));
    badge.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); badge.click(); }
    });

    const label = `${fileName} · ${metrics.lines.toLocaleString('es')} líneas`;
    badge.textContent = `📄 ${label}  ▶`;

    doc.body.appendChild(badge);
    requestAnimationFrame(() => { badge.style.opacity = '1'; });

    badgeTimer = setTimeout(removeBadge, BADGE_TTL_MS);
    return badge;
  };
}

/** Crea el overlay modal. Devuelve `show(text, fileName, metrics)`. */
function createPreviewOverlay(doc = document) {
  let backdrop = null;

  function close() {
    if (!backdrop) return;
    const el = backdrop;
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 200);
    backdrop = null;
    doc.removeEventListener('keydown', onKeydown, true);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  }

  return function show(text, fileName, metrics) {
    if (backdrop) close();

    backdrop = doc.createElement('div');
    backdrop.id = 'nocrash-preview-overlay';
    Object.assign(backdrop.style, {
      position: 'fixed',
      inset: '0',
      zIndex: String(Z),
      background: 'rgba(0,0,0,.55)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      opacity: '0',
      transition: 'opacity .2s ease',
      font: '14px/1.5 system-ui, sans-serif',
    });

    const lines = text.split('\n');
    const lineNumbers = lines.map((_, i) => i + 1).join('\n');
    const meta = `${metrics.chars.toLocaleString('es')} caracteres · ${metrics.lines.toLocaleString('es')} líneas`;

    backdrop.innerHTML = `
      <div data-panel style="background:#1a1a2e;color:#e5e7eb;border-radius:14px;
        width:min(92vw,1024px);height:min(86vh,720px);display:flex;flex-direction:column;
        box-shadow:0 24px 70px rgba(0,0,0,.5);overflow:hidden">
        <div style="display:flex;align-items:center;justify-content:space-between;
          padding:14px 20px;border-bottom:1px solid #374151;gap:12px">
          <div style="display:flex;align-items:center;gap:10px;min-width:0">
            <span style="font-size:20px;flex-shrink:0">📄</span>
            <div style="min-width:0">
              <div style="font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(fileName)}</div>
              <div style="font-size:12px;color:#9ca3af">${escapeHtml(meta)}</div>
            </div>
          </div>
          <button data-action="close" aria-label="Cerrar" style="background:none;border:none;
            color:#9ca3af;cursor:pointer;font-size:24px;padding:2px 10px;line-height:1;
            flex-shrink:0;border-radius:6px">×</button>
        </div>
        <div data-scroll style="flex:1;overflow:auto;display:flex;min-height:0">
          <pre data-linenos style="margin:0;padding:14px 10px;text-align:right;
            color:#4b5563;font:13px/1.6 'Menlo','Consolas','DejaVu Sans Mono',monospace;
            user-select:none;border-right:1px solid #374151;white-space:pre;tab-size:4">${escapeHtml(lineNumbers)}</pre>
          <pre data-code style="margin:0;padding:14px 18px;flex:1;min-width:0;
            font:13px/1.6 'Menlo','Consolas','DejaVu Sans Mono',monospace;
            white-space:pre-wrap;word-break:break-word;color:#e5e7eb;tab-size:4">${escapeHtml(text)}</pre>
        </div>
      </div>`;

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop || e.target?.dataset?.action === 'close') close();
    });
    doc.addEventListener('keydown', onKeydown, true);

    doc.body.appendChild(backdrop);
    requestAnimationFrame(() => { if (backdrop) backdrop.style.opacity = '1'; });

    // Sincroniza el scroll de los números de línea con el código
    const scrollContainer = backdrop.querySelector('[data-scroll]');
    const lineEl = backdrop.querySelector('[data-linenos]');
    scrollContainer?.addEventListener('scroll', () => {
      if (lineEl) lineEl.scrollTop = scrollContainer.scrollTop;
    }, { passive: true });

    return backdrop;
  };
}
