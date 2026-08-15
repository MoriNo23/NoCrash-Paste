import { insertTextInto, setInputFile } from '../dom.js';

/**
 * Adaptador del banco de pruebas (test/sandbox.html).
 * Solo se activa si el documento lleva data-nocrash-test, así que jamás
 * puede dispararse en un sitio real.
 */
export const sandboxAdapter = {
  id: 'sandbox',

  matches: () => document.documentElement.hasAttribute('data-nocrash-test'),

  isEditor(element) {
    if (!element || typeof element.closest !== 'function') return false;
    return !!element.closest('[contenteditable="true"]') || element.matches?.('textarea');
  },

  attach(file, { doc = document } = {}) {
    return setInputFile(doc.querySelector('input[type="file"]'), file);
  },

  insertText(element, text) {
    return insertTextInto(element.closest?.('[contenteditable="true"]') || element, text);
  },
};
