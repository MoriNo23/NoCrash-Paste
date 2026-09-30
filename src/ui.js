/** Toast y panel de ajustes. Sin dependencias del sitio anfitrión. */

import { DEFAULTS } from './config.js';

const Z = 2147483647;

export function createToaster(doc = document) {
  return function toast(message, kind = 'ok', ttl = 4200) {
    const el = doc.createElement('div');
    el.className = 'nocrash-toast';
    el.textContent = message;
    Object.assign(el.style, {
      position: 'fixed',
      zIndex: String(Z),
      bottom: '24px',
      left: '50%',
      transform: 'translateX(-50%)',
      maxWidth: '520px',
      padding: '12px 18px',
      borderRadius: '10px',
      font: '13px/1.45 system-ui, sans-serif',
      color: '#fff',
      background: kind === 'warn' ? '#92400e' : '#1f2937',
      boxShadow: '0 8px 28px rgba(0,0,0,.35)',
      opacity: '0',
      transition: 'opacity .18s ease',
      pointerEvents: 'none',
    });
    doc.body.appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity = '1';
    });
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 250);
    }, ttl);
    return el;
  };
}

export const SETTING_ROWS = [
  ['maxChars', 'Máx. caracteres', 'number'],
  ['maxLines', 'Máx. líneas', 'number'],
  ['maxBytes', 'Máx. bytes', 'number'],
  ['previewLines', 'Líneas de preview', 'number'],
  ['placeholder', 'Dejar resumen en el editor', 'checkbox'],
  ['preview', 'Badge de vista previa', 'checkbox'],
  ['includePreview', 'Incluir preview del código', 'checkbox'],
  ['notify', 'Mostrar aviso', 'checkbox'],
  ['debug', 'Log de depuración', 'checkbox'],
];

/** Lee los inputs del panel y devuelve un objeto de configuración parcial. */
export function readSettingsForm(root) {
  const values = {};
  root.querySelectorAll('input[data-key]').forEach((input) => {
    values[input.dataset.key] = input.type === 'checkbox' ? input.checked : Number(input.value);
  });
  return values;
}

export function createSettingsPanel({ config, onSave, onReset, doc = document }) {
  return function open() {
    if (doc.getElementById('nocrash-settings')) return null;

    const backdrop = doc.createElement('div');
    backdrop.id = 'nocrash-settings';
    Object.assign(backdrop.style, {
      position: 'fixed',
      inset: '0',
      zIndex: String(Z),
      background: 'rgba(0,0,0,.55)',
      display: 'grid',
      placeItems: 'center',
      font: '14px/1.5 system-ui, sans-serif',
    });

    backdrop.innerHTML = `
      <div style="background:#111827;color:#e5e7eb;border-radius:14px;padding:22px 24px;width:380px;box-shadow:0 20px 60px rgba(0,0,0,.5)">
        <h2 style="margin:0 0 4px;font-size:16px">NoCrash Paste</h2>
        <p style="margin:0 0 16px;font-size:12px;color:#9ca3af">Se intercepta el pegado si supera <b>cualquiera</b> de los límites.</p>
        <div data-rows style="display:grid;gap:10px"></div>
        <div style="display:flex;gap:8px;margin-top:20px;justify-content:flex-end">
          <button data-action="reset" style="padding:7px 12px;border-radius:8px;border:1px solid #374151;background:transparent;color:#9ca3af;cursor:pointer">Restaurar</button>
          <button data-action="close" style="padding:7px 12px;border-radius:8px;border:1px solid #374151;background:transparent;color:#e5e7eb;cursor:pointer">Cerrar</button>
          <button data-action="save" style="padding:7px 14px;border-radius:8px;border:0;background:#7c5cff;color:#fff;cursor:pointer">Guardar</button>
        </div>
      </div>`;

    const rows = backdrop.querySelector('[data-rows]');
    for (const [key, label, type] of SETTING_ROWS) {
      const row = doc.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px';
      const span = doc.createElement('span');
      span.style.fontSize = '13px';
      span.textContent = label;
      const input = doc.createElement('input');
      input.type = type;
      input.dataset.key = key;
      if (type === 'checkbox') {
        input.checked = !!config[key];
      } else {
        input.value = String(config[key]);
        input.style.cssText =
          'width:120px;padding:5px 8px;border-radius:6px;border:1px solid #374151;background:#0b1120;color:#e5e7eb';
      }
      row.append(span, input);
      rows.appendChild(row);
    }

    backdrop.addEventListener('click', (event) => {
      const action = event.target?.dataset?.action;
      if (event.target === backdrop || action === 'close') {
        backdrop.remove();
        return;
      }
      if (action === 'reset') {
        onReset?.({ ...DEFAULTS });
        backdrop.remove();
        return;
      }
      if (action === 'save') {
        onSave?.(readSettingsForm(backdrop));
        backdrop.remove();
      }
    });

    doc.body.appendChild(backdrop);
    return backdrop;
  };
}
