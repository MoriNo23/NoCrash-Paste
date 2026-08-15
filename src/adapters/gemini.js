import { dropFileOn, insertTextInto, setInputFile, sleep } from '../dom.js';

const OPENER_SELECTOR = [
  'button[aria-label*="adjunt" i]',
  'button[aria-label*="attach" i]',
  'button[aria-label*="añadir archivo" i]',
  'button[aria-label*="add file" i]',
  'uploader-button button',
].join(',');

const EDITOR_SELECTOR = 'rich-textarea, .ql-editor, [contenteditable="true"]';

export const DEFAULT_TIMEOUT_MS = 2500;
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

  /** Si el input aún no está montado, abrimos el menú "+" para forzarlo. */
  async ensureFileInput({ doc = document, timeout = DEFAULT_TIMEOUT_MS, step = POLL_STEP_MS } = {}) {
    let input = this.findFileInput(doc);
    if (input) return input;

    const opener = doc.querySelector(OPENER_SELECTOR);
    if (opener) opener.click();

    const deadline = Date.now() + timeout;
    while (!input && Date.now() < deadline) {
      await sleep(step);
      input = this.findFileInput(doc);
    }

    if (opener) {
      doc.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
    return input;
  },

  async attach(file, { doc = document, timeout = DEFAULT_TIMEOUT_MS } = {}) {
    const input = await this.ensureFileInput({ doc, timeout });
    if (input) return setInputFile(input, file);
    const zone = doc.querySelector(EDITOR_SELECTOR) || doc.body;
    return dropFileOn(zone, file);
  },

  insertText(element, text) {
    const editor = element.closest?.('.ql-editor, [contenteditable="true"]') || element;
    return insertTextInto(editor, text);
  },
};
