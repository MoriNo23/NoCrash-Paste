import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RESULT, SKIP, createPasteHandler } from '../../src/handler.js';
import { DEFAULTS } from '../../src/config.js';
import { bigCode, makeDeps, makeFakeAdapter, makePasteEvent } from './helpers.js';

const config = () => ({ ...DEFAULTS });

describe('createPasteHandler · cuándo NO intervenir', () => {
  it('ignora eventos sin clipboardData', async () => {
    const onPaste = createPasteHandler(makeDeps({ config: config() }));
    const event = { clipboardData: null, preventDefault: vi.fn() };
    expect(await onPaste(event)).toEqual({ skipped: SKIP.NO_CLIPBOARD });
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('deja pasar el portapapeles que ya trae archivos', async () => {
    const deps = makeDeps({ config: config() });
    const onPaste = createPasteHandler(deps);
    const event = makePasteEvent({ text: bigCode(), files: [{ name: 'foto.png' }] });

    expect(await onPaste(event)).toEqual({ skipped: SKIP.HAS_FILES });
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(deps.adapter.attach).not.toHaveBeenCalled();
  });

  it('ignora pastes sin texto plano', async () => {
    const onPaste = createPasteHandler(makeDeps({ config: config() }));
    expect(await onPaste(makePasteEvent({ text: '' }))).toEqual({ skipped: SKIP.NO_TEXT });
  });

  it('ignora pastes fuera del compositor', async () => {
    const adapter = makeFakeAdapter({ isEditor: vi.fn(() => false) });
    const onPaste = createPasteHandler(makeDeps({ adapter, config: config() }));
    const event = makePasteEvent({ text: bigCode() });

    expect(await onPaste(event)).toEqual({ skipped: SKIP.NOT_EDITOR });
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('deja pasar texto por debajo de los límites', async () => {
    const deps = makeDeps({ config: config() });
    const onPaste = createPasteHandler(deps);
    const event = makePasteEvent({ text: 'arregla este typo porfa' });

    const out = await onPaste(event);
    expect(out.skipped).toBe(SKIP.UNDER_LIMITS);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(deps.adapter.attach).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('usa composedPath()[0] cuando existe (shadow DOM)', async () => {
    const inner = { id: 'dentro-del-shadow' };
    const adapter = makeFakeAdapter({ isEditor: vi.fn(() => true) });
    const onPaste = createPasteHandler(makeDeps({ adapter, config: config() }));
    const event = makePasteEvent({ text: bigCode(), target: inner });

    await onPaste(event);
    expect(adapter.isEditor).toHaveBeenCalledWith(inner);
  });

  it('cae a event.target si no hay composedPath', async () => {
    const target = { id: 'plano' };
    const adapter = makeFakeAdapter();
    const onPaste = createPasteHandler(makeDeps({ adapter, config: config() }));
    await onPaste(makePasteEvent({ text: bigCode(), target, composed: false }));
    expect(adapter.isEditor).toHaveBeenCalledWith(target);
  });
});

describe('createPasteHandler · interceptación', () => {
  let deps;
  let onPaste;

  beforeEach(() => {
    deps = makeDeps({ config: config() });
    onPaste = createPasteHandler(deps);
  });

  it('bloquea el evento para que el sitio nunca renderice el texto', async () => {
    const event = makePasteEvent({ text: bigCode() });
    await onPaste(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it('crea el archivo con el texto íntegro y nombre derivado del lenguaje', async () => {
    const text = bigCode();
    await onPaste(makePasteEvent({ text }));

    expect(deps.makeFile).toHaveBeenCalledOnce();
    const [fileText, fileName] = deps.makeFile.mock.calls[0];
    expect(fileText).toBe(text); // nada se pierde
    expect(fileName).toBe('pegado-javascript-20260815-090503.txt');
  });

  it('adjunta el archivo mediante el adaptador', async () => {
    await onPaste(makePasteEvent({ text: bigCode() }));
    expect(deps.adapter.attach).toHaveBeenCalledOnce();
    expect(deps.adapter.attach.mock.calls[0][0]).toMatchObject({
      name: 'pegado-javascript-20260815-090503.txt',
    });
  });

  it('inserta un placeholder corto en vez del codebase', async () => {
    const text = bigCode();
    await onPaste(makePasteEvent({ text }));

    expect(deps.adapter.insertText).toHaveBeenCalledOnce();
    const inserted = deps.adapter.insertText.mock.calls[0][1];
    expect(inserted).toContain('[Adjunto:');
    expect(inserted.length).toBeLessThan(text.length / 10);
  });

  it('espera antes de escribir para que el sitio monte el chip', async () => {
    await onPaste(makePasteEvent({ text: bigCode() }));
    expect(deps.sleep).toHaveBeenCalledWith(120);
  });

  it('devuelve el resultado con métricas y motivos', async () => {
    const out = await onPaste(makePasteEvent({ text: bigCode() }));
    expect(out.result).toBe(RESULT.ATTACHED);
    expect(out.metrics.lines).toBe(4000);
    expect(out.language.name).toBe('javascript');
    expect(out.hits.length).toBeGreaterThan(0);
  });

  it('avisa al usuario de lo que ha pasado', async () => {
    await onPaste(makePasteEvent({ text: bigCode() }));
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining('adjunto'), 'ok');
  });
});

describe('createPasteHandler · respeta la configuración', () => {
  it('no inserta placeholder si está desactivado', async () => {
    const deps = makeDeps({ config: { ...DEFAULTS, placeholder: false } });
    await createPasteHandler(deps)(makePasteEvent({ text: bigCode() }));
    expect(deps.adapter.attach).toHaveBeenCalled();
    expect(deps.adapter.insertText).not.toHaveBeenCalled();
  });

  it('no notifica si está desactivado', async () => {
    const deps = makeDeps({ config: { ...DEFAULTS, notify: false } });
    await createPasteHandler(deps)(makePasteEvent({ text: bigCode() }));
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('lee la configuración en cada paste (cambios en caliente)', async () => {
    const cfg = { ...DEFAULTS, maxChars: 10, maxLines: 1e9, maxBytes: 1e9 };
    const deps = makeDeps({ config: cfg });
    const onPaste = createPasteHandler(deps);

    expect((await onPaste(makePasteEvent({ text: 'texto de 30 caracteres aprox' }))).result)
      .toBe(RESULT.ATTACHED);

    cfg.maxChars = 1e9;
    expect((await onPaste(makePasteEvent({ text: 'texto de 30 caracteres aprox' }))).skipped)
      .toBe(SKIP.UNDER_LIMITS);
  });

  it('un umbral bajo intercepta textos pequeños', async () => {
    const deps = makeDeps({ config: { ...DEFAULTS, maxChars: 5 } });
    const out = await createPasteHandler(deps)(makePasteEvent({ text: 'seis+letras' }));
    expect(out.result).toBe(RESULT.ATTACHED);
  });
});

describe('createPasteHandler · degradación cuando falla el adjunto', () => {
  it('descarga el .txt si attach devuelve false', async () => {
    const adapter = makeFakeAdapter({ attach: vi.fn(async () => false) });
    const deps = makeDeps({ adapter, config: config() });
    const out = await createPasteHandler(deps)(makePasteEvent({ text: bigCode() }));

    expect(out.result).toBe(RESULT.FALLBACK_DOWNLOAD);
    expect(deps.downloadFile).toHaveBeenCalledOnce();
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining('a mano'), 'warn');
    expect(adapter.insertText).not.toHaveBeenCalled();
  });

  it('descarga el .txt si attach lanza excepción', async () => {
    const adapter = makeFakeAdapter({
      attach: vi.fn(async () => { throw new Error('uploader no montado'); }),
    });
    const deps = makeDeps({ adapter, config: config() });
    const out = await createPasteHandler(deps)(makePasteEvent({ text: bigCode() }));

    expect(out.result).toBe(RESULT.FALLBACK_DOWNLOAD);
    expect(deps.downloadFile).toHaveBeenCalledOnce();
    expect(deps.log).toHaveBeenCalledWith('fallo al adjuntar', expect.any(Error));
  });

  it('trata un attach que devuelve undefined como fallo', async () => {
    const adapter = makeFakeAdapter({ attach: vi.fn(async () => undefined) });
    const deps = makeDeps({ adapter, config: config() });
    expect((await createPasteHandler(deps)(makePasteEvent({ text: bigCode() }))).result)
      .toBe(RESULT.FALLBACK_DOWNLOAD);
  });

  it('el texto nunca se pierde: el archivo descargado lo contiene entero', async () => {
    const text = bigCode();
    const adapter = makeFakeAdapter({ attach: vi.fn(async () => false) });
    const deps = makeDeps({ adapter, config: config() });
    await createPasteHandler(deps)(makePasteEvent({ text }));
    expect(deps.downloadFile.mock.calls[0][0].text).toBe(text);
  });
});

describe('createPasteHandler · dependencias opcionales', () => {
  it('funciona sin notify/sleep/log/now inyectados', async () => {
    const adapter = makeFakeAdapter();
    const onPaste = createPasteHandler({
      adapter,
      config: config(),
      makeFile: (text, name) => ({ name, text }),
      downloadFile: () => {},
    });
    const out = await onPaste(makePasteEvent({ text: bigCode() }));
    expect(out.result).toBe(RESULT.ATTACHED);
  });

  it('tolera eventos sin stopImmediatePropagation', async () => {
    const deps = makeDeps({ config: config() });
    const event = makePasteEvent({ text: bigCode() });
    delete event.stopImmediatePropagation;
    await expect(createPasteHandler(deps)(event)).resolves.toMatchObject({ result: RESULT.ATTACHED });
  });
});
