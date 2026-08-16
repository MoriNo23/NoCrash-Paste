// Evita que src/main.js arranque solo cuando algún test lo importe.
globalThis.__NOCRASH_NO_AUTOSTART__ = true;

// jsdom no implementa estas APIs que sí usa el userscript.
if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
}
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => 'blob:nocrash/mock';
  URL.revokeObjectURL = () => {};
}

// jsdom no implementa DataTransfer ni DragEvent: polyfill mínimo pero fiel
// al contrato que usa el userscript (items.add + .files iterable e indexable).
if (typeof globalThis.DataTransfer !== 'function') {
  class FileListMock extends Array {
    item(i) { return this[i] ?? null; }
  }
  globalThis.DataTransfer = class DataTransfer {
    constructor() {
      this._files = new FileListMock();
      this.items = { add: (file) => this._files.push(file) };
      this.types = [];
    }
    get files() { return this._files; }
    getData() { return ''; }
    setData() {}
  };
}

if (typeof globalThis.DragEvent !== 'function') {
  globalThis.DragEvent = class DragEvent extends Event {
    constructor(type, init = {}) {
      super(type, init);
      this.dataTransfer = init.dataTransfer ?? null;
    }
  };
}

// jsdom no implementa Blob#text()/arrayBuffer() de forma completa.
if (typeof Blob !== 'undefined' && typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function text() {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}
