/**
 * Tests nacidos del informe de mutation testing (`npm run mutation`).
 * Cada bloque mata mutantes concretos que sobrevivían a la suite original:
 * constantes vacías, condiciones invertidas, flags de eventos, etc.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESULT, SKIP, createPasteHandler } from '../../src/handler.js';
import { DEFAULTS, STORE_KEY, createStore, normalizeConfig } from '../../src/config.js';
import { downloadFile, dropFileOn, insertTextInto, makeFile, setInputFile } from '../../src/dom.js';
import { TEXT_ACCEPTS, acceptsText, geminiAdapter } from '../../src/adapters/gemini.js';
import { sandboxAdapter } from '../../src/adapters/sandbox.js';
import { bigCode, makeDeps, makePasteEvent } from './helpers.js';

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-nocrash-test');
});
afterEach(() => vi.restoreAllMocks());

describe('constantes públicas (contrato con el resto del código)', () => {
  it('SKIP tiene valores literales estables y no vacíos', () => {
    expect(SKIP).toEqual({
      NO_CLIPBOARD: 'no-clipboard-data',
      HAS_FILES: 'clipboard-has-files',
      NO_TEXT: 'no-text',
      NOT_EDITOR: 'not-editor',
      UNDER_LIMITS: 'under-limits',
    });
    expect(new Set(Object.values(SKIP)).size).toBe(5); // todos distintos
  });

  it('RESULT tiene valores literales estables y distintos', () => {
    expect(RESULT).toEqual({ ATTACHED: 'attached', FALLBACK_DOWNLOAD: 'fallback-download' });
    expect(RESULT.ATTACHED).not.toBe(RESULT.FALLBACK_DOWNLOAD);
  });

  it('SKIP y RESULT están congelados', () => {
    expect(Object.isFrozen(SKIP)).toBe(true);
    expect(Object.isFrozen(RESULT)).toBe(true);
  });

  it('DEFAULTS expone exactamente las claves esperadas con sus valores', () => {
    expect(DEFAULTS).toEqual({
      maxChars: 20000,
      maxLines: 1500,
      maxBytes: 200000,
      placeholder: true,
      includePreview: true,
      previewLines: 12,
      notify: true,
      debug: false,
    });
  });

  it('STORE_KEY va namespaced para no chocar con el sitio', () => {
    expect(STORE_KEY).toBe('nocrash-paste:config');
  });
});

describe('normalizeConfig · cada clave se respeta individualmente', () => {
  it.each([
    ['maxChars', 111],
    ['maxLines', 222],
    ['maxBytes', 333],
    ['previewLines', 4],
  ])('respeta %s', (key, value) => {
    const out = normalizeConfig({ [key]: value });
    expect(out[key]).toBe(value);
    // el resto sigue en su default
    for (const other of Object.keys(DEFAULTS)) {
      if (other !== key) expect(out[other]).toBe(DEFAULTS[other]);
    }
  });

  it.each(['placeholder', 'includePreview', 'notify', 'debug'])('respeta el flag %s', (key) => {
    expect(normalizeConfig({ [key]: !DEFAULTS[key] })[key]).toBe(!DEFAULTS[key]);
  });

  it('un string en blanco no pisa el default', () => {
    expect(normalizeConfig({ maxChars: '   ' }).maxChars).toBe(DEFAULTS.maxChars);
  });
});

describe('createStore · cada backend se usa de verdad', () => {
  it('lee de localStorage un valor que NO escribió esta instancia', () => {
    const storage = { getItem: vi.fn(() => '{"maxChars":42}'), setItem: vi.fn(), removeItem: vi.fn() };
    expect(createStore({ storage }).read()).toEqual({ maxChars: 42 });
    expect(storage.getItem).toHaveBeenCalledWith(STORE_KEY);
  });

  it('lee de GM_getValue un valor que NO escribió esta instancia', () => {
    const getValue = vi.fn(() => '{"maxLines":9}');
    expect(createStore({ getValue }).read()).toEqual({ maxLines: 9 });
  });

  it('sin backend y sin escrituras devuelve {} (no revienta)', () => {
    expect(createStore().read()).toEqual({});
  });

  it('clear borra también la copia en memoria', () => {
    const store = createStore();
    store.write({ maxChars: 5 });
    store.clear();
    expect(store.read()).toEqual({});
  });

  it('write devuelve el JSON serializado y trata null como {}', () => {
    expect(createStore().write(null)).toBe('{}');
  });

  it('clear usa GM_setValue cuando existe, en vez de localStorage', () => {
    const setValue = vi.fn();
    const storage = { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() };
    createStore({ setValue, storage }).clear();
    expect(setValue).toHaveBeenCalledWith(STORE_KEY, null);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});

describe('targetOf · resolución del elemento pegado', () => {
  it('usa event.target si composedPath no es una función', async () => {
    const deps = makeDeps({ config: { ...DEFAULTS } });
    const event = makePasteEvent({ text: bigCode(), target: { id: 'destino' }, composed: false });
    event.composedPath = 'no soy una función';
    await createPasteHandler(deps)(event);
    expect(deps.adapter.isEditor).toHaveBeenCalledWith({ id: 'destino' });
  });

  it('usa event.target si composedPath devuelve una lista vacía', async () => {
    const deps = makeDeps({ config: { ...DEFAULTS } });
    const target = { id: 'destino' };
    const event = makePasteEvent({ text: bigCode(), target, composed: false });
    event.composedPath = () => [];
    await createPasteHandler(deps)(event);
    expect(deps.adapter.isEditor).toHaveBeenCalledWith(target);
  });
});

describe('targetOf · shadow DOM real', () => {
  it('prefiere el nodo de composedPath aunque event.target sea el host', async () => {
    const nodoInterno = { id: 'dentro-del-shadow' };
    const host = { id: 'host' };
    const deps = makeDeps({ config: { ...DEFAULTS } });
    const event = makePasteEvent({ text: bigCode(), target: host, composed: false });
    event.composedPath = () => [nodoInterno, host];

    await createPasteHandler(deps)(event);
    expect(deps.adapter.isEditor).toHaveBeenCalledWith(nodoInterno);
    expect(deps.adapter.isEditor).not.toHaveBeenCalledWith(host);
  });
});

describe('handler · detalles observables', () => {
  it('registra el motivo de la interceptación en el log', async () => {
    const deps = makeDeps({ config: { ...DEFAULTS } });
    await createPasteHandler(deps)(makePasteEvent({ text: bigCode() }));
    expect(deps.log).toHaveBeenCalledWith('interceptado', expect.arrayContaining([expect.any(String)]));
  });

  it('el aviso de éxito enumera los motivos separados por ·', async () => {
    const deps = makeDeps({ config: { ...DEFAULTS } });
    await createPasteHandler(deps)(makePasteEvent({ text: bigCode() }));
    const [message, kind] = deps.notify.mock.calls[0];
    expect(kind).toBe('ok');
    expect(message).toMatch(/caracteres/);
    expect(message).toMatch(/líneas/);
    expect(message).toContain('·');
  });

  it('el aviso de fallback nombra el archivo descargado', async () => {
    const deps = makeDeps({
      config: { ...DEFAULTS },
      adapter: { ...makeDeps().adapter, attach: vi.fn(async () => false) },
    });
    const out = await createPasteHandler(deps)(makePasteEvent({ text: bigCode() }));
    expect(deps.notify.mock.calls[0][0]).toContain(out.fileName);
  });

  it('un attach que devuelve una cadena vacía cuenta como fallo', async () => {
    const deps = makeDeps({
      config: { ...DEFAULTS },
      adapter: { ...makeDeps().adapter, attach: vi.fn(async () => '') },
    });
    expect((await createPasteHandler(deps)(makePasteEvent({ text: bigCode() }))).result)
      .toBe(RESULT.FALLBACK_DOWNLOAD);
  });

  it('el retardo antes de escribir es configurable', async () => {
    const deps = makeDeps({ config: { ...DEFAULTS }, settleDelay: 999 });
    await createPasteHandler(deps)(makePasteEvent({ text: bigCode() }));
    expect(deps.sleep).toHaveBeenCalledWith(999);
  });

  it('separa los motivos con " · " en el aviso', async () => {
    const deps = makeDeps({ config: { ...DEFAULTS } });
    await createPasteHandler(deps)(makePasteEvent({ text: bigCode() }));
    expect(deps.notify.mock.calls[0][0]).toMatch(/caracteres · [\d.]+ líneas/);
  });

  it('sin `now` inyectado usa la fecha real del sistema', async () => {
    const adapter = makeDeps().adapter;
    const out = await createPasteHandler({
      adapter,
      config: { ...DEFAULTS },
      makeFile: (text, name) => ({ name, text }),
      downloadFile: () => {},
    })(makePasteEvent({ text: bigCode() }));

    const hoy = new Date();
    const p = (n) => String(n).padStart(2, '0');
    expect(out.fileName).toContain(`${hoy.getFullYear()}${p(hoy.getMonth() + 1)}${p(hoy.getDate())}`);
    expect(out.fileName).toMatch(/^pegado-javascript-\d{8}-\d{6}\.txt$/);
  });

  it('un portapapeles con files vacío SÍ se procesa', async () => {
    const deps = makeDeps({ config: { ...DEFAULTS } });
    const out = await createPasteHandler(deps)(makePasteEvent({ text: bigCode(), files: [] }));
    expect(out.result).toBe(RESULT.ATTACHED);
  });

  it('pide explícitamente text/plain al portapapeles', async () => {
    const deps = makeDeps({ config: { ...DEFAULTS } });
    const event = makePasteEvent({ text: bigCode() });
    await createPasteHandler(deps)(event);
    expect(event.clipboardData.getData).toHaveBeenCalledWith('text/plain');
  });
});

describe('dom · flags de eventos y valores de retorno', () => {
  it('setInputFile funciona aunque .files sea de solo lectura', () => {
    const input = document.createElement('input');
    input.type = 'file';
    Object.defineProperty(input, 'files', {
      configurable: true,
      get: () => null,
      set: () => { throw new TypeError('readonly'); },
    });
    document.body.appendChild(input);

    expect(setInputFile(input, makeFile('x', 'ro.txt'))).toBe(true);
    expect(input.files[0].name).toBe('ro.txt');
  });

  it('el evento input del uploader burbujea', () => {
    const wrapper = document.createElement('div');
    const input = document.createElement('input');
    input.type = 'file';
    wrapper.append(input);
    document.body.append(wrapper);
    const spy = vi.fn();
    wrapper.addEventListener('input', spy);
    setInputFile(input, makeFile('x', 'a.txt'));
    expect(spy).toHaveBeenCalledOnce();
  });

  it('los eventos de drag burbujean y son composed', () => {
    const zone = document.createElement('div');
    document.body.append(zone);
    const seen = [];
    document.body.addEventListener('drop', (e) => seen.push(e.composed));
    dropFileOn(zone, makeFile('x', 'a.txt'));
    expect(seen).toEqual([true]); // burbujeó hasta body y venía composed
  });

  it('insertTextInto también maneja <input type="text">', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = 'ab';
    document.body.append(input);
    expect(insertTextInto(input, 'C')).toBe(true);
    expect(input.value).toBe('abC');
  });

  it('insertTextInto enfoca el editor antes de escribir', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.append(editor);
    const focus = vi.fn();
    editor.focus = focus;
    document.execCommand = vi.fn(() => true);

    insertTextInto(editor, 'x');
    expect(focus).toHaveBeenCalledOnce();
  });

  it('devuelve true tras insertar en contenteditable', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.append(editor);
    document.execCommand = vi.fn(() => true);
    expect(insertTextInto(editor, 'x')).toBe(true);
  });

  it('no reescribe el contenido si execCommand ya insertó', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.textContent = 'previo';
    document.body.append(editor);
    document.execCommand = vi.fn(() => true);

    insertTextInto(editor, 'NUEVO');
    expect(editor.textContent).toBe('previo'); // execCommand se encargó
  });

  it('usa la selección viva del usuario cuando cae al fallback', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.textContent = 'HOLAMUNDO';
    document.body.append(editor);
    document.execCommand = vi.fn(() => false);

    const range = document.createRange();
    range.setStart(editor.firstChild, 4);
    range.setEnd(editor.firstChild, 4);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    insertTextInto(editor, '-X-');
    expect(editor.textContent).toBe('HOLA-X-MUNDO'); // insertado en el cursor, no al final
  });

  it('ignora una selección que está fuera del editor', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.textContent = 'fin';
    const fuera = document.createElement('p');
    fuera.textContent = 'otro sitio';
    document.body.append(editor, fuera);
    document.execCommand = vi.fn(() => false);

    const range = document.createRange();
    range.selectNodeContents(fuera);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    insertTextInto(editor, '+X');
    expect(editor.textContent).toBe('fin+X');
    expect(fuera.textContent).toBe('otro sitio');
  });

  it('el evento input del textarea burbujea', () => {
    const wrapper = document.createElement('div');
    const ta = document.createElement('textarea');
    wrapper.append(ta);
    document.body.append(wrapper);
    const spy = vi.fn();
    wrapper.addEventListener('input', spy);
    insertTextInto(ta, 'x');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('el InputEvent del fallback burbujea hasta el documento', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.append(editor);
    document.execCommand = vi.fn(() => false);
    const spy = vi.fn();
    document.addEventListener('input', spy);
    insertTextInto(editor, 'x');
    expect(spy).toHaveBeenCalledOnce();
    document.removeEventListener('input', spy);
  });

  it('sin ninguna selección activa escribe al final sin romperse', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.textContent = 'fin';
    document.body.append(editor);
    document.execCommand = vi.fn(() => false);
    window.getSelection().removeAllRanges(); // rangeCount === 0

    expect(() => insertTextInto(editor, '+X')).not.toThrow();
    expect(editor.textContent).toBe('fin+X');
  });

  it('el enlace de descarga es invisible y se limpia', () => {
    const editor = document.createElement('div');
    document.body.append(editor);
    let seen = null;
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = realCreate(tag);
      if (tag === 'a') el.click = () => { seen = { display: el.style.display, name: el.download }; };
      return el;
    });
    downloadFile(makeFile('x', 'oculto.txt'));
    expect(seen).toEqual({ display: 'none', name: 'oculto.txt' });
  });
});

describe('gemini · acceptsText', () => {
  it.each(TEXT_ACCEPTS)('acepta %s', (accept) => {
    expect(acceptsText(accept)).toBe(true);
  });

  it('acepta un accept vacío o ausente', () => {
    expect(acceptsText('')).toBe(true);
    expect(acceptsText(undefined)).toBe(true);
  });

  it('acepta listas con espacios y mayúsculas', () => {
    expect(acceptsText(' image/png ,  TEXT/PLAIN ')).toBe(true);
  });

  it.each(['image/*', 'image/png,image/jpeg', 'video/mp4', 'application/pdf'])(
    'rechaza %s',
    (accept) => {
      expect(acceptsText(accept)).toBe(false);
    }
  );
});

describe('gemini · detalles del adaptador', () => {
  it('matches() es true exactamente en gemini.google.com', () => {
    const original = globalThis.location;
    Object.defineProperty(globalThis, 'location', {
      value: { hostname: 'gemini.google.com' },
      configurable: true,
      writable: true,
    });
    expect(geminiAdapter.matches()).toBe(true);

    globalThis.location = { hostname: 'gemini.google.com.evil.tld' };
    expect(geminiAdapter.matches()).toBe(false);

    Object.defineProperty(globalThis, 'location', { value: original, configurable: true, writable: true });
  });

  it('no dispara Escape si nunca abrió un menú', async () => {
    const keys = [];
    document.body.addEventListener('keydown', (e) => keys.push(e.key));
    await geminiAdapter.ensureFileInput({ doc: document, timeout: 20, step: 5 });
    expect(keys).toEqual([]);
  });

  it('el Escape que cierra el menú burbujea', async () => {
    document.body.innerHTML = '<button aria-label="Adjuntar archivo">+</button>';
    const keys = [];
    document.addEventListener('keydown', (e) => keys.push(e.key)); // en document, no en body
    await geminiAdapter.ensureFileInput({ doc: document, timeout: 20, step: 5 });
    expect(keys).toContain('Escape');
  });

  it('attach respeta el timeout que se le pasa', async () => {
    const t0 = Date.now();
    await geminiAdapter.attach(makeFile('x', 'a.txt'), { doc: document, timeout: 40 });
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('clica el botón de adjuntar para forzar el montaje del input', async () => {
    document.body.innerHTML = '<button aria-label="Adjuntar archivo">+</button>';
    const click = vi.fn();
    document.querySelector('button').addEventListener('click', click);
    await geminiAdapter.ensureFileInput({ doc: document, timeout: 20, step: 5 });
    expect(click).toHaveBeenCalledOnce();
  });

  it('isEditor no revienta con elementos sin matches()', () => {
    expect(geminiAdapter.isEditor({ closest: () => null })).toBeFalsy();
  });

  it('insertText no revienta con elementos sin closest()', () => {
    document.execCommand = vi.fn(() => false);
    const falso = {
      tagName: 'DIV',
      textContent: '',
      focus: vi.fn(),
      contains: () => false,
      dispatchEvent: vi.fn(() => true),
    };
    expect(() => geminiAdapter.insertText(falso, 'RESUMEN')).not.toThrow();
    expect(falso.textContent).toBe('RESUMEN');
  });

  it('insertText usa el propio elemento si no hay contenedor de editor', () => {
    const ta = document.createElement('textarea');
    document.body.append(ta);
    geminiAdapter.insertText(ta, 'RESUMEN');
    expect(ta.value).toBe('RESUMEN');
  });

  it('isEditor reconoce un textarea suelto vía matches()', () => {
    document.body.innerHTML = '<textarea id="t"></textarea>';
    expect(geminiAdapter.isEditor(document.getElementById('t'))).toBe(true);
  });
});

describe('sandbox · adaptador de pruebas', () => {
  it('matches() devuelve booleano estricto', () => {
    expect(sandboxAdapter.matches()).toBe(false);
    document.documentElement.setAttribute('data-nocrash-test', '');
    expect(sandboxAdapter.matches()).toBe(true);
  });

  it('isEditor: textarea sí, div normal no', () => {
    document.body.innerHTML = '<textarea id="ta"></textarea><div id="d"></div>';
    expect(sandboxAdapter.isEditor(document.getElementById('ta'))).toBe(true);
    expect(sandboxAdapter.isEditor(document.getElementById('d'))).toBe(false);
  });

  it('insertText escribe en el contenteditable contenedor', () => {
    document.body.innerHTML = '<div contenteditable="true"><span id="t"></span></div>';
    document.execCommand = vi.fn(() => false);
    sandboxAdapter.insertText(document.getElementById('t'), 'RESUMEN');
    expect(document.querySelector('[contenteditable]').textContent).toContain('RESUMEN');
  });

  it('isEditor no revienta con elementos sin matches()', () => {
    expect(sandboxAdapter.isEditor({ closest: () => null })).toBeFalsy();
  });

  it('insertText cae al propio elemento si no hay contenedor', () => {
    const ta = document.createElement('textarea');
    document.body.append(ta);
    sandboxAdapter.insertText(ta, 'texto');
    expect(ta.value).toBe('texto');
  });
});
