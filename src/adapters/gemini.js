import { dropFileOn, insertTextInto, setInputFile, sleep } from '../dom.js';

/* Gemini español: el botón "+" abre un MENÚ (no el picker directo).
 * aria-label confirmado en vivo: "Cargas y herramientas".
 * En inglés e Inbox se vio "Upload & tools" / "Add files". */
const OPENER_SELECTOR = [
  'button[aria-label*="cargas" i]',
  'button[aria-label*="upload" i]',
  'button[aria-label*="adjunt" i]',
  'button[aria-label*="attach" i]',
  'button[aria-label*="añadir archivo" i]',
  'button[aria-label*="add file" i]',
  'uploader-button button',
].join(',');

/* El menú desplegado por el "+" tiene items. El que abre el file picker de
 * texto/código se identifica por aria-label que contiene "Archivos" o
 * "Subir archivos" (feature-flag entre ambos), y no es Cámara/Drive/Photos. */
const MENU_ITEM_SELECTOR = [
  '[role="menuitem"][aria-label*="archivos" i]',
  '[role="menuitem"][aria-label*="subir" i]',
  '[role="menuitem"][aria-label*="upload" i]',
  'mat-mdc-menu-item[aria-label*="archivos" i]',
  'mat-mdc-menu-item[aria-label*="subir" i]',
].join(',');

const EDITOR_SELECTOR = 'rich-textarea, .ql-editor, [contenteditable="true"]';

export const DEFAULT_TIMEOUT_MS = 4000;
export const POLL_STEP_MS = 100;

/** Tipos MIME/extensiones que aceptamos como "sirve para un .txt". */
export const TEXT_ACCEPTS = ['*/*', 'text/*', 'text/plain', '.txt'];

/** "image/*" NO vale; un accept vacío significa "cualquier cosa". */
export function acceptsText(accept) {
  if (!accept) return true;
  return accept
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .some((token) => TEXT_ACCEPTS.includes(token));
}

/** Adaptador para gemini.google.com (compositor Quill dentro de <rich-textarea>). */
export const geminiAdapter = {
  id: 'gemini',

  matches: () => globalThis.location?.hostname === 'gemini.google.com',

  isEditor(element) {
    if (!element || typeof element.closest !== 'function') return false;
    return !!element.closest(EDITOR_SELECTOR) || element.matches?.('textarea');
  },

  /** Gemini expone varios input[type=file]; queremos el que acepte texto. */
  findFileInput(doc = document) {
    const inputs = [...doc.querySelectorAll('input[type="file"]')];
    return inputs.find((input) => acceptsText(input.accept)) || inputs[0] || null;
  },

  /** Si el input aún no está montado, abrimos el menú "+" y cliqueamos el
   * item "Archivos" para forzar la creación del input[type=file].
   * Gemini llama input.click() automáticamente tras crearlo, lo que abre
   * el file picker nativo — suprimimos ese click porque nosotros ya
   * inyectamos el archivo programáticamente. */
  async ensureFileInput({ doc = document, timeout = DEFAULT_TIMEOUT_MS, step = POLL_STEP_MS } = {}) {
    let input = this.findFileInput(doc);
    if (input) return input;

    const opener = doc.querySelector(OPENER_SELECTOR);
    if (!opener) return null;

    // Suprimir input.click() programático que abre el picker nativo.
    // Solo interceptamos type=file para no romper otros clicks.
    const HTMLInputProto = doc.defaultView?.HTMLInputElement?.prototype;
    const origClick = HTMLInputProto?.click;
    let suppressed = false;
    if (HTMLInputProto && origClick) {
      HTMLInputProto.click = function () {
        if (this.type === 'file') { suppressed = true; return; }
        return origClick.call(this);
      };
    }

    try {
      opener.click();
      await sleep(step);

      const menuItem = doc.querySelector(MENU_ITEM_SELECTOR);
      if (menuItem) menuItem.click();

      const deadline = Date.now() + timeout;
      while (!input && Date.now() < deadline) {
        await sleep(step);
        input = this.findFileInput(doc);
      }
    } finally {
      if (HTMLInputProto && origClick) HTMLInputProto.click = origClick;
    }

    return input;
  },

  async attach(file, { doc = document, timeout = DEFAULT_TIMEOUT_MS } = {}) {
    const input = await this.ensureFileInput({ doc, timeout });
    if (input) return setInputFile(input, file) ? 'input' : false;
    // Fallback de drag&drop: es "mejor esfuerzo" — Gemini puede filtrar
    // eventos sintéticos (isTrusted=false). Devolvemos 'drop' para que el
    // caller sepa que es un resultado incierto, no confirmado.
    const zone = doc.querySelector(EDITOR_SELECTOR) || doc.body;
    return dropFileOn(zone, file) ? 'drop' : false;
  },

  insertText(element, text) {
    const editor = element.closest?.('.ql-editor, [contenteditable="true"]') || element;
    return insertTextInto(editor, text);
  },
};
