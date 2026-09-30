/**
 * Configuración y persistencia.
 *
 * Los defaults salen de medir cuándo se satura un contenteditable en equipos
 * modestos (~4 GB de RAM): a partir de ~20k caracteres el editor lag[u]ea en
 * cada tecla, y por encima de ~200 KB la pestaña suele morir por OOM.
 */

export const DEFAULTS = Object.freeze({
  maxChars: 20000,
  maxLines: 1500,
  maxBytes: 200000,
  placeholder: false,
  preview: true,
  includePreview: true,
  previewLines: 12,
  notify: true,
  debug: false,
});

export const STORE_KEY = 'nocrash-paste:config';

/** Claves numéricas: se saneen al leer/guardar para no romper la comparación. */
const NUMERIC_KEYS = ['maxChars', 'maxLines', 'maxBytes', 'previewLines'];
const BOOLEAN_KEYS = ['placeholder', 'preview', 'includePreview', 'notify', 'debug'];

/**
 * Crea un almacén sobre GM_* si existe, con fallback a localStorage y, si
 * tampoco hay, a memoria (útil en tests y en páginas con storage bloqueado).
 */
export function createStore(env = {}) {
  const { getValue, setValue, storage } = env;
  let memory = null;

  return {
    read() {
      let raw = null;
      try {
        if (typeof getValue === 'function') raw = getValue(STORE_KEY, null);
        else if (storage) raw = storage.getItem(STORE_KEY);
        else raw = memory;
      } catch {
        raw = memory;
      }
      if (!raw) return {};
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    },
    write(obj) {
      const raw = JSON.stringify(obj ?? {});
      memory = raw;
      try {
        if (typeof setValue === 'function') setValue(STORE_KEY, raw);
        else if (storage) storage.setItem(STORE_KEY, raw);
      } catch {
        /* storage bloqueado: nos quedamos con la copia en memoria */
      }
      return raw;
    },
    clear() {
      memory = null;
      try {
        if (typeof setValue === 'function') setValue(STORE_KEY, null);
        else if (storage) storage.removeItem(STORE_KEY);
      } catch {
        /* noop */
      }
    },
  };
}

/**
 * Mezcla los defaults con lo guardado, descartando claves desconocidas y
 * valores inválidos (NaN, negativos, tipos raros).
 */
export function normalizeConfig(partial = {}) {
  const out = { ...DEFAULTS };
  if (!partial || typeof partial !== 'object') return out;

  for (const key of NUMERIC_KEYS) {
    const raw = partial[key];
    // Number(null)===0 y Number([])===0: exigimos número o string numérico real.
    if (typeof raw !== 'number' && typeof raw !== 'string') continue;
    if (typeof raw === 'string' && raw.trim() === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) out[key] = Math.floor(value);
  }
  for (const key of BOOLEAN_KEYS) {
    if (typeof partial[key] === 'boolean') out[key] = partial[key];
  }
  return out;
}

export function loadConfig(store) {
  return normalizeConfig(store.read());
}
