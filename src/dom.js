/** Utilidades DOM compartidas por los adaptadores. */

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function makeFile(text, fileName) {
  return new File([text], fileName, { type: 'text/plain' });
}

/** Mete un File en un <input type="file"> como si el usuario lo hubiese elegido. */
export function setInputFile(input, file) {
  if (!input) return false;
  const dt = new DataTransfer();
  dt.items.add(file);
  try {
    input.files = dt.files;
  } catch {
    // Algunos navegadores/entornos tratan .files como readonly.
    Object.defineProperty(input, 'files', { value: dt.files, configurable: true, writable: true });
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

/** Fallback: simular que se suelta el archivo sobre una zona del compositor. */
export function dropFileOn(zone, file) {
  if (!zone) return false;
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  const options = { bubbles: true, cancelable: true, composed: true, dataTransfer };
  for (const type of ['dragenter', 'dragover', 'drop']) {
    zone.dispatchEvent(new DragEvent(type, options));
  }
  return true;
}

/**
 * Escribe texto en el compositor respetando el undo stack y notificando al
 * framework del sitio (Quill/Angular/React escuchan `input`).
 */
export function insertTextInto(element, text) {
  if (!element) return false;

  if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? element.value.length;
    element.value = element.value.slice(0, start) + text + element.value.slice(end);
    element.selectionStart = element.selectionEnd = start + text.length;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  element.focus?.();
  let handled = false;
  try {
    handled = !!(typeof document.execCommand === 'function' && document.execCommand('insertText', false, text));
  } catch {
    handled = false;
  }

  if (!handled) {
    const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
    if (selection && selection.rangeCount && element.contains(selection.anchorNode)) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
    } else {
      element.textContent += text;
    }
    element.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })
    );
  }
  return true;
}

/** Último recurso: descargar el .txt para que el usuario lo suba a mano. */
export function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return url;
}
