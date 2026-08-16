import { geminiAdapter } from './adapters/gemini.js';
import { sandboxAdapter } from './adapters/sandbox.js';
import { createStore, loadConfig, normalizeConfig } from './config.js';
import { downloadFile, makeFile, sleep } from './dom.js';
import { createPasteHandler } from './handler.js';
import { createSettingsPanel, createToaster } from './ui.js';

export const ADAPTERS = [sandboxAdapter, geminiAdapter];

export function pickAdapter(adapters = ADAPTERS) {
  return adapters.find((adapter) => {
    try {
      return adapter.matches();
    } catch {
      return false;
    }
  }) || null;
}

export function bootstrap({ adapters = ADAPTERS, gm = {} } = {}) {
  const adapter = pickAdapter(adapters);
  if (!adapter) return null;

  const store = createStore({
    getValue: gm.getValue,
    setValue: gm.setValue,
    storage: typeof localStorage !== 'undefined' ? localStorage : null,
  });

  const config = loadConfig(store);
  const log = (...args) => config.debug && console.log('%c[NoCrash]', 'color:#7c5cff', ...args);
  const toast = createToaster();

  const handler = createPasteHandler({
    adapter,
    config,
    makeFile,
    downloadFile,
    notify: toast,
    sleep,
    log,
  });

  document.addEventListener('paste', handler, true); // capture: antes que el sitio

  const openSettings = createSettingsPanel({
    config,
    onSave: (values) => {
      Object.assign(config, normalizeConfig({ ...config, ...values }));
      store.write(config);
      toast('Ajustes guardados.');
    },
    onReset: (defaults) => {
      store.clear();
      Object.assign(config, defaults);
      toast('Ajustes restaurados a los valores por defecto.');
    },
  });

  gm.registerMenuCommand?.('⚙️ Ajustes de NoCrash Paste', openSettings);
  window.addEventListener('keydown', (event) => {
    if (event.altKey && event.shiftKey && event.code === 'KeyP') {
      event.preventDefault();
      openSettings();
    }
  });

  log('activo', adapter.id, config);
  return { adapter, config, handler, openSettings, store };
}

// Autoarranque solo en navegador (los tests importan sin ejecutar).
if (typeof document !== 'undefined' && !globalThis.__NOCRASH_NO_AUTOSTART__) {
  bootstrap({
    gm: {
      getValue: typeof GM_getValue === 'function' ? GM_getValue : undefined,
      setValue: typeof GM_setValue === 'function' ? GM_setValue : undefined,
      registerMenuCommand:
        typeof GM_registerMenuCommand === 'function' ? GM_registerMenuCommand : undefined,
    },
  });
}
