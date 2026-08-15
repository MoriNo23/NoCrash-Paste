import {
  buildFileName,
  buildPlaceholder,
  detectLanguage,
  exceedsLimits,
  measure,
} from './analyze.js';

/** Motivos por los que un paste NO se intercepta (útiles en tests y en el log). */
export const SKIP = Object.freeze({
  NO_CLIPBOARD: 'no-clipboard-data',
  HAS_FILES: 'clipboard-has-files',
  NO_TEXT: 'no-text',
  NOT_EDITOR: 'not-editor',
  UNDER_LIMITS: 'under-limits',
});

export const RESULT = Object.freeze({
  ATTACHED: 'attached',
  FALLBACK_DOWNLOAD: 'fallback-download',
});

function targetOf(event) {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : null;
  return (path && path[0]) || event.target;
}

/**
 * Construye el listener de `paste`. Todas las dependencias se inyectan para
 * que los tests puedan sustituirlas sin tocar el DOM real.
 *
 * @param {object} deps
 * @param {object} deps.adapter    adaptador del sitio
 * @param {object} deps.config     configuración viva (se lee en cada paste)
 * @param {(text:string,name:string)=>File} deps.makeFile
 * @param {(file:File)=>void}  deps.downloadFile
 * @param {(msg:string,kind?:string)=>void} deps.notify
 * @param {(ms:number)=>Promise} deps.sleep
 * @param {()=>Date} deps.now
 * @param {(...a:any[])=>void} deps.log
 */
export function createPasteHandler(deps) {
  const {
    adapter,
    config,
    makeFile,
    downloadFile,
    // Defaults no-op: sus mutantes son equivalentes (no-op -> no-op).
    // Stryker disable next-line ArrowFunction
    notify = () => {},
    // Stryker disable next-line ArrowFunction
    sleep = () => Promise.resolve(),
    now = () => new Date(),
    // Stryker disable next-line ArrowFunction
    log = () => {},
    settleDelay = 120,
  } = deps;

  return async function onPaste(event) {
    const clipboard = event.clipboardData;
    if (!clipboard) return { skipped: SKIP.NO_CLIPBOARD };

    // Si ya vienen archivos reales, el sitio sabe manejarlos mejor que nosotros.
    if (clipboard.files && clipboard.files.length > 0) return { skipped: SKIP.HAS_FILES };

    const text = clipboard.getData('text/plain');
    if (!text) return { skipped: SKIP.NO_TEXT };

    const target = targetOf(event);
    if (!adapter.isEditor(target)) return { skipped: SKIP.NOT_EDITOR };

    const metrics = measure(text);
    const hits = exceedsLimits(metrics, config);
    if (hits.length === 0) return { skipped: SKIP.UNDER_LIMITS, metrics };

    // A partir de aquí tomamos el control: el sitio nunca ve este paste.
    event.preventDefault();
    event.stopImmediatePropagation?.();
    log('interceptado', hits);

    const language = detectLanguage(text);
    const fileName = buildFileName(language, now());
    const file = makeFile(text, fileName);

    let attached = false;
    try {
      attached = !!(await adapter.attach(file));
    } catch (error) {
      log('fallo al adjuntar', error);
      attached = false;
    }

    if (!attached) {
      downloadFile(file);
      notify(`No pude adjuntarlo automáticamente. Te lo descargué como ${fileName}: súbelo a mano.`, 'warn');
      return { result: RESULT.FALLBACK_DOWNLOAD, fileName, metrics, language, hits };
    }

    if (config.placeholder) {
      await sleep(settleDelay); // deja que el sitio monte el chip del adjunto
      adapter.insertText(target, buildPlaceholder({ fileName, metrics, language, text, config }));
    }

    if (config.notify) {
      notify(`Pegado convertido en adjunto · ${hits.join(' · ')}`, 'ok');
    }

    return { result: RESULT.ATTACHED, fileName, metrics, language, hits };
  };
}
